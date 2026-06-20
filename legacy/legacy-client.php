<?php
// ── 1. Leer configuración desde variables de entorno ───────────────
// getenv() con valor por defecto: si la variable no existe (por
// ejemplo corriendo el script suelto, fuera de Docker), usa el
// fallback para que igual se pueda probar contra un backend local.
$apiBaseUrl = getenv('API_BASE_URL') ?: 'http://localhost:3000';
$apiKey     = getenv('LEGACY_API_KEY') ?: 'dev-key';

// ── 2. Parámetros de consulta ───────────────────────────────────────
// El sistema legacy puede pedir una página específica via argumento
// de línea de comandos (php legacy-client.php 2 10) o usa los
// valores por defecto: primera página, 20 incidentes.
$page  = isset($argv[1]) ? (int) $argv[1] : 1;
$limit = isset($argv[2]) ? (int) $argv[2] : 20;

// Por contrato de HU5, este script consulta específicamente
// incidentes en estado OPEN.
$url = sprintf(
    '%s/api/incidents?status=OPEN&page=%d&limit=%d',
    rtrim($apiBaseUrl, '/'),
    $page,
    $limit
);

echo "──────────────────────────────────────────────\n";
echo " Sistema Legacy PHP — Consulta de Incidentes\n";
echo "──────────────────────────────────────────────\n";
echo "Consultando: {$url}\n\n";

// ── 3. Petición HTTP con cURL ────────────────────────────────────────
// Uso cURL en vez de file_get_contents() porque necesito control de
// timeout y de cabeceras personalizadas (x-api-key), y porque es el
// cliente HTTP más universal disponible en cualquier instalación de
// PHP, sin depender de extensiones adicionales.
$ch = curl_init($url);

curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,   // devuelve el body como string en vez de imprimirlo directo
    CURLOPT_TIMEOUT        => 10,     // si la API no responde en 10s, falla en vez de colgar el script
    CURLOPT_HTTPHEADER     => [
        'x-api-key: ' . $apiKey,      // autenticación de sistema-a-sistema (no JWT de usuario)
        'Accept: application/json',
    ],
]);

$response   = curl_exec($ch);
$httpStatus = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErrno  = curl_errno($ch);
$curlError  = curl_error($ch);
curl_close($ch);

// ── 4. Manejo de errores explícito ──────────────────────────────────
// No asumo que la API siempre responde bien. Si cURL falla a nivel
// de red (API caída, DNS, timeout) o la API responde con un código
// distinto de 200, el script termina con un mensaje claro y un
// exit code distinto de 0, para que cualquier proceso que lo invoque
// (cron, otro script) sepa que algo salió mal.
if ($curlErrno !== 0) {
    fwrite(STDERR, "[ERROR] No se pudo conectar con la API: {$curlError}\n");
    echo json_encode([
        'error'   => 'No fue posible conectar con la API de incidentes',
        'errno'   => $curlErrno,
        'detail'  => $curlError,
    ], JSON_PRETTY_PRINT) . "\n";
    exit(1);
}

if ($httpStatus !== 200) {
    fwrite(STDERR, "[ERROR] La API respondió con estado HTTP {$httpStatus}\n");
    echo json_encode([
        'error'  => 'La API de incidentes respondió con un error',
        'status' => $httpStatus,
        'body'   => json_decode($response, true) ?? $response,
    ], JSON_PRETTY_PRINT) . "\n";
    exit(1);
}

// ── 5. Decodificar y transformar la respuesta ───────────────────────
$body = json_decode($response, true);

if (!is_array($body) || !isset($body['data'])) {
    fwrite(STDERR, "[ERROR] Respuesta inesperada de la API (no trae 'data')\n");
    echo $response . "\n";
    exit(1);
}

// El sistema legacy solo necesita un subconjunto de campos, no el
// incidente completo (no le interesa la descripción larga ni el
// array de relatedEventTraceIds, por ejemplo). Por eso transformo
// la respuesta a la forma mínima que pide explícitamente la HU5:
// id, aplicación afectada, severidad, estado y fecha de creación.
$incidentes = array_map(function ($incidente) {
    return [
        'id'          => $incidente['id'],
        'aplicacion'  => $incidente['affectedApp'],
        'severidad'   => $incidente['severity'],
        'estado'      => $incidente['status'],
        'creado_en'   => $incidente['createdAt'],
    ];
}, $body['data']);

$resultado = [
    'paginacion' => [
        'pagina_actual'   => $body['page'],
        'total_paginas'   => $body['totalPages'],
        'total_registros' => $body['total'],
    ],
    'incidentes' => $incidentes,
];

// ── 6. Salida ────────────────────────────────────────────────────────
echo json_encode($resultado, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";

echo "\n──────────────────────────────────────────────\n";
echo " Total de incidentes abiertos encontrados: " . count($incidentes) . "\n";
echo "──────────────────────────────────────────────\n";
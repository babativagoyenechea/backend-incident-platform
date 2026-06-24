<?php
// Lee config desde variables de entorno; si no existen usa valores de desarrollo
$apiBaseUrl = getenv('API_BASE_URL') ?: 'http://localhost:3000';
$apiKey     = getenv('LEGACY_API_KEY') ?: 'dev-key';

// Paginación por argumento o valores por defecto
$page  = isset($argv[1]) ? (int) $argv[1] : 1;
$limit = isset($argv[2]) ? (int) $argv[2] : 20;

// Por contrato, este cliente consulta únicamente incidentes OPEN
$url = sprintf(
    '%s/api/incidents?status=OPEN&page=%d&limit=%d',
    rtrim($apiBaseUrl, '/'),
    $page,
    $limit
);

echo "--------------------------------------------\n";
echo " Sistema Legacy PHP - Consulta de Incidentes\n";
echo "--------------------------------------------\n";
echo "Consultando: {$url}\n\n";

// curl en lugar de file_get_contents: permite timeout y headers personalizados
$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 10,
    CURLOPT_HTTPHEADER     => [
        'x-api-key: ' . $apiKey,
        'Accept: application/json',
    ],
]);

$response   = curl_exec($ch);
$httpStatus = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErrno  = curl_errno($ch);
$curlError  = curl_error($ch);
curl_close($ch);

if ($curlErrno !== 0) {
    fwrite(STDERR, "[ERROR] No se pudo conectar con la API: {$curlError}\n");
    echo json_encode([
        'error'  => 'No fue posible conectar con la API de incidentes',
        'errno'  => $curlErrno,
        'detail' => $curlError,
    ], JSON_PRETTY_PRINT) . "\n";
    exit(1);
}

if ($httpStatus !== 200) {
    fwrite(STDERR, "[ERROR] La API respondio con estado HTTP {$httpStatus}\n");
    echo json_encode([
        'error'  => 'La API respondio con un error',
        'status' => $httpStatus,
        'body'   => json_decode($response, true) ?? $response,
    ], JSON_PRETTY_PRINT) . "\n";
    exit(1);
}

$body = json_decode($response, true);
if (!is_array($body) || !isset($body['data'])) {
    fwrite(STDERR, "[ERROR] Respuesta inesperada de la API\n");
    echo $response . "\n";
    exit(1);
}

// Mapeo al subset que necesita el sistema legacy
$incidentes = array_map(function ($inc) {
    return [
        'id'         => $inc['id'],
        'aplicacion' => $inc['affectedApp'],
        'severidad'  => $inc['severity'],
        'estado'     => $inc['status'],
        'creado_en'  => $inc['createdAt'],
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

echo json_encode($resultado, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
echo "\n--------------------------------------------\n";
echo " Total incidentes abiertos: " . count($incidentes) . "\n";
echo "--------------------------------------------\n";
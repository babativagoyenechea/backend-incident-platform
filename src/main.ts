import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { TraceIdInterceptor } from './modules/shared/interceptors/trace-id.interceptor';
import { GlobalExceptionFilter } from './modules/shared/filters/global-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  app.enableCors({
    origin: ['http://localhost:5173'],
    methods: ['GET', 'POST', 'PATCH'],
    credentials: true,
  });
  app.setGlobalPrefix('api');

  // whitelist strict: evitar que lleguen campos extra a los casos de uso
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  app.useGlobalInterceptors(new TraceIdInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('Plataforma de Gestión de Incidentes y Monitoreo Operacional')
    .setDescription(
      'API REST para registro de eventos, gestión de incidentes, alertas automáticas y métricas en tiempo real.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Token JWT para endpoints de operadores' },
      'JWT',
    )
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'x-api-key', description: 'API Key para integración del sistema PHP Legacy' },
      'ApiKey',
    )
    .addTag('Events', 'Registro de eventos operacionales desde sistemas externos')
    .addTag('Incidents', 'Gestión del ciclo de vida de incidentes con auditoría transaccional')
    .addTag('Dashboard', 'Métricas consolidadas con Cache Aside Pattern')
    .addTag('Health', 'Verificación del estado de las dependencias del sistema')
    .addTag('Auth', 'Autenticación y generación de credenciales de acceso para operadores')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  app.enableShutdownHooks();
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Backend corriendo en el puerto: ${port}`);
}
bootstrap();
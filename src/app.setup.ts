import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { REFRESH_COOKIE_NAME } from './modules/auth/refresh-cookie';

export interface AppSetupOptions {
  enableSwagger?: boolean;
}

/**
 * Configuración HTTP compartida por producción y el arnés E2E.
 * Mantenerla en un solo lugar evita que las pruebas ejerciten una app distinta.
 */
export function setupApp(app: INestApplication, options: AppSetupOptions = {}): void {
  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
  });

  if (options.enableSwagger === false) return;

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Plataforma Clínica Hospitalaria — API')
    .setDescription(
      'API interna del sistema de digitalización y registro de historias clínicas. ' +
        'Swagger/OpenAPI es la fuente de tipos del frontend.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .addCookieAuth(REFRESH_COOKIE_NAME, { type: 'apiKey', in: 'cookie' }, 'refresh-cookie')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}

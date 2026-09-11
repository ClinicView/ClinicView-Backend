import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { REFRESH_COOKIE_NAME } from './modules/auth/refresh-cookie';
import { json } from 'express';
import type { NextFunction, Request, Response } from 'express';

export interface AppSetupOptions {
  enableSwagger?: boolean;
}

/**
 * Configuración HTTP compartida por producción y el arnés E2E.
 * Mantenerla en un solo lugar evita que las pruebas ejerciten una app distinta.
 */
export function setupApp(app: INestApplication, options: AppSetupOptions = {}): void {
  app.setGlobalPrefix('api');
  // A page-by-page provenance snapshot can exceed Express's 100 kB default.
  // Keep the larger bound local to this DTO-validated endpoint.
  const spatialReviewJson = json({ limit: '4mb' });
  app.use(
    '/api/patients/:patientId/documents/:id/ocr-layout/review',
    function spatialReviewJsonParser(request: Request, response: Response, next: NextFunction) {
      // Nest detects default parsers by function name. The scoped wrapper must
      // not be named jsonParser, or Nest would skip JSON parsing for login, etc.
      spatialReviewJson(request, response, next);
    },
  );

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

  const document = SwaggerModule.createDocument(app, createSwaggerConfig());
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}

export function createSwaggerConfig() {
  return new DocumentBuilder()
    .setTitle('Plataforma Clínica Hospitalaria — API')
    .setDescription(
      'API interna del sistema de digitalización y registro de historias clínicas. ' +
        'Swagger/OpenAPI es la fuente de tipos del frontend.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .addCookieAuth(REFRESH_COOKIE_NAME, { type: 'apiKey', in: 'cookie' }, 'refresh-cookie')
    .build();
}

import { INestApplication, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

/**
 * HTTP setup shared by main.ts and the e2e tests, so tests hit the same
 * routes (/v1/...) and CORS rules as production.
 */
export function configureApp(app: INestApplication): void {
  // Every route is versioned in the URL: /v1/health, /v1/tenants, ...
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Only the known Flourishive frontends may call the API from a browser.
  // Mobile, desktop and external systems authenticate with tokens instead.
  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });

  // Raw CSV uploads (people import) arrive as text/csv.
  (app as NestExpressApplication).useBodyParser('text', {
    type: 'text/csv',
    limit: '2mb',
  });
  // Raw uploads (files module): the Content-Type is the file's type.
  (app as NestExpressApplication).useBodyParser('raw', {
    type: [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    limit: '20mb',
  });
  app.use(cookieParser());
  // Behind cPanel's proxy; needed so req.ip is the client, not the proxy.
  (app as INestApplication & { set(k: string, v: unknown): void }).set(
    'trust proxy',
    1,
  );

  app.enableShutdownHooks();
}

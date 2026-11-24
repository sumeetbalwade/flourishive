import { INestApplication, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import {
  RequestIdExceptionFilter,
  requestIdMiddleware,
} from './platform/http/request-id.js';
import {
  CLOUDFLARE_RANGES,
  cloudflareMatcher,
  visitorIp,
} from './platform/http/cloudflare.js';
import { requestLogMiddleware } from './platform/http/request-log.js';
import { ErrorLogService } from './modules/logs/error-log.service.js';
import { LogWriterService } from './modules/logs/log-writer.service.js';
import { corsOrigins } from './platform/config/config.js';
import { MaintenanceService } from './modules/controls/maintenance.service.js';
import { originMatcher } from './modules/company/tenant-host.js';

/**
 * HTTP setup shared by main.ts and the e2e tests, so tests hit the same
 * routes (/v1/...) and CORS rules as production.
 */
export function configureApp(app: INestApplication): void {
  // Every route is versioned in the URL: /v1/health, /v1/tenants, ...
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Only the known Flourishive frontends may call the API from a browser.
  // Mobile, desktop and external systems authenticate with tokens instead.
  const origins = corsOrigins(process.env.CORS_ORIGINS, process.env.APP_DOMAIN)
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  // An entry may contain * for one subdomain label, e.g. https://*.flourishive.in.
  const allowed = originMatcher(origins);
  app.enableCors({
    origin: (
      origin: string | undefined,
      done: (err: Error | null, allow?: boolean) => void,
    ) => done(null, allowed(origin)),
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
  });

  // Webhooks are signed over the exact bytes sent, so keep them next to the parsed JSON.
  (app as NestExpressApplication).useBodyParser('json', {
    verify: (
      req: { url?: string; rawBody?: Buffer },
      _res: unknown,
      buf: Buffer,
    ) => {
      if (req.url?.includes('/webhooks/')) req.rawBody = buf;
    },
  } as never);
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
      'image/webp',
      'image/svg+xml',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    limit: '20mb',
  });
  app.use(requestIdMiddleware);
  app.use(app.get(MaintenanceService).middleware());
  app.use(requestLogMiddleware(app.get(LogWriterService)));
  app.useGlobalFilters(new RequestIdExceptionFilter(app.get(ErrorLogService)));
  app.use(cookieParser());
  // Behind cPanel's proxy; needed so req.ip is the client, not the proxy.
  (app as INestApplication & { set(k: string, v: unknown): void }).set(
    'trust proxy',
    1,
  );

  // Behind Cloudflare every request arrives from a Cloudflare address, so lockouts and rate limits
  // would see one visitor. With TRUST_CLOUDFLARE=true the real address is read from CF-Connecting-IP,
  // but only when the connection itself comes from a Cloudflare range.
  if (process.env.TRUST_CLOUDFLARE === 'true') {
    const isCloudflare = cloudflareMatcher(
      process.env.CLOUDFLARE_IP_RANGES?.split(',')
        .map((r) => r.trim())
        .filter(Boolean) ?? CLOUDFLARE_RANGES,
    );
    app.use(
      (
        req: {
          ip?: string;
          headers: Record<string, string | string[] | undefined>;
        },
        _res: unknown,
        next: () => void,
      ) => {
        const ip = visitorIp(
          req.ip,
          req.headers['cf-connecting-ip'],
          isCloudflare,
        );
        if (ip && ip !== req.ip)
          Object.defineProperty(req, 'ip', { value: ip, configurable: true });
        next();
      },
    );
  }

  app.enableShutdownHooks();
}

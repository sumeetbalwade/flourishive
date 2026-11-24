import type { Params } from 'nestjs-pino';
import { currentRequestId } from './request-id.js';

/** What pino must never print (D-67). Paths cover headers, bodies and the common secret field names. */
export const REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.code',
  '*.token',
  '*.secret',
  '*.otp',
  '*.body',
  '*.html',
  '*.text',
];

/**
 * Structured request lines on stdout, which journald keeps. Every line carries the request id, company,
 * person and route template. Query strings are cut off the URL, because they can hold tokens.
 */
export function loggerParams(env: string | undefined): Params {
  return {
    pinoHttp: {
      level: env === 'test' ? 'silent' : 'info',
      genReqId: () => currentRequestId() ?? 'none',
      redact: { paths: REDACT, censor: '[redacted]' },
      customProps: (req) => {
        const r = req as typeof req & {
          auth?: { tenantId?: string; userId?: string };
          platformAuth?: { platformUserId?: string };
          route?: { path?: string };
        };
        return {
          requestId: currentRequestId(),
          tenantId: r.auth?.tenantId,
          actor: r.auth?.userId ?? r.platformAuth?.platformUserId,
          route: r.route?.path,
        };
      },
      serializers: {
        req: (req: { id?: string; method?: string; url?: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url?.split('?')[0],
        }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      },
      autoLogging: { ignore: (req) => req.url?.includes('/health') ?? false },
    },
  };
}

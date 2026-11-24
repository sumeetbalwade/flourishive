import type { NextFunction, Request, Response } from 'express';
import type { LogWriterService } from '../../modules/logs/log-writer.service.js';
import { currentRequestId, routeOf } from './request-id.js';

/**
 * One line per request, written when the response is finished (D-67). It reads who made the request from
 * what the guards already put on it, so it adds no lookups.
 */
export function requestLogMiddleware(writer: LogWriterService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const started = process.hrtime.bigint();
    const requestId = currentRequestId();
    res.on('finish', () => {
      const r = req as Request & {
        auth?: { tenantId?: string; userId?: string; support?: unknown };
        platformAuth?: { platformUserId?: string };
      };
      const ua = req.headers['user-agent'];
      void writer.request({
        requestId: requestId ?? 'none',
        tenantId: r.auth?.tenantId ?? null,
        actorType: r.platformAuth
          ? 'PLATFORM'
          : r.auth
            ? r.auth.support
              ? 'SUPPORT'
              : 'USER'
            : null,
        actorId: r.auth?.userId ?? r.platformAuth?.platformUserId ?? null,
        method: req.method,
        routePattern: routeOf(req),
        status: res.statusCode,
        durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
        ip: req.ip ?? null,
        userAgent: typeof ua === 'string' ? ua : null,
      });
    });
    next();
  };
}

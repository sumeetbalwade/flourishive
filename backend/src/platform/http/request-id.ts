import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ErrorLogService } from '../../modules/logs/error-log.service.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

const storage = new AsyncLocalStorage<{ requestId: string }>();

/** The id of the request being handled, or undefined outside one (jobs, startup). */
export const currentRequestId = () => storage.getStore()?.requestId;

// An id supplied by a caller is kept only when it is short and plain, so it cannot carry anything odd into logs.
const SAFE = /^[A-Za-z0-9._-]{8,64}$/;

/** Accepts or makes `X-Request-Id`, keeps it for the whole request and returns it on the response. */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const given = req.headers['x-request-id'];
  const id =
    typeof given === 'string' && SAFE.test(given) ? given : randomUUID();
  res.setHeader('X-Request-Id', id);
  storage.run({ requestId: id }, next);
}

/** Every error body carries the request id, so a person can quote it and support can find the log line. */
@Catch()
export class RequestIdExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('Http');

  constructor(private readonly errors?: ErrorLogService) {}

  /** Keeps the error with a readable story. Best effort: it never throws and never delays the reply. */
  private keep(exception: unknown, req: Request): void {
    const r = req as Request & {
      auth?: { tenantId?: string; userId?: string };
      platformAuth?: { platformUserId?: string };
    };
    void this.errors?.record(exception, {
      requestId: currentRequestId(),
      tenantId: r.auth?.tenantId ?? null,
      actorId: r.auth?.userId ?? r.platformAuth?.platformUserId ?? null,
      actorType: r.platformAuth ? 'PLATFORM' : r.auth ? 'USER' : null,
      method: req.method,
      route: routeOf(req),
    });
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = currentRequestId();
    if (exception instanceof HttpException) {
      // A 5xx raised on purpose (bad gateway and so on) is still a fault worth keeping; a 4xx is the caller's.
      if (exception.getStatus() >= 500)
        this.keep(exception, host.switchToHttp().getRequest<Request>());
      const body = exception.getResponse();
      res
        .status(exception.getStatus())
        .json(
          typeof body === 'string'
            ? { statusCode: exception.getStatus(), message: body, requestId }
            : { ...body, requestId },
        );
      return;
    }
    // Errors raised by Express itself (a body that is too large, malformed JSON) carry their own status.
    const e = exception as {
      status?: unknown;
      expose?: unknown;
      message?: unknown;
    };
    if (typeof e.status === 'number' && e.expose === true) {
      res.status(e.status).json({
        statusCode: e.status,
        message: String(e.message),
        requestId,
      });
      return;
    }
    this.keep(exception, host.switchToHttp().getRequest<Request>());
    this.log.error(
      `${requestId ?? '-'} ${exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)}`,
    );
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: 'Something went wrong on our side',
      requestId,
    });
  }
}

/** The route template (`/v1/people/:id`), never the raw URL, so no ids or query values reach the logs. */
export function routeOf(req: Request): string {
  const path = (req.route as { path?: unknown } | undefined)?.path;
  return typeof path === 'string' ? `${req.baseUrl ?? ''}${path}` : 'unmatched';
}

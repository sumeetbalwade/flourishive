import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
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

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = currentRequestId();
    if (exception instanceof HttpException) {
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

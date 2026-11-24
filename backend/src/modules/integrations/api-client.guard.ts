import type { ApiScope } from '@flourishive/schemas';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { RedisService } from '../../platform/cache/redis.service.js';
import { ApiClientsService, type ApiPrincipal } from './api-clients.service.js';

export type ApiRequest = Request & { apiClient?: ApiPrincipal };

const SCOPE = 'apiScope';
/** The route needs this scope in the caller's token. */
export const RequireScope = (scope: ApiScope) => SetMetadata(SCOPE, scope);

/**
 * Guards the public API: a valid client token, the route's scope, and the client's own rate limit
 * (a fixed one minute window kept in Redis). Answers carry the usual X-RateLimit headers.
 */
@Injectable()
export class ApiClientGuard implements CanActivate {
  constructor(
    private readonly clients: ApiClientsService,
    private readonly redis: RedisService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<ApiRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer '))
      throw new UnauthorizedException('invalid_token');
    const who = await this.clients.authenticate(h.slice(7));
    req.apiClient = who;

    const minute = Math.floor(Date.now() / 60_000);
    const key = `api:rate:${who.clientDbId}:${minute}`;
    const used = await this.redis.client.incr(key);
    if (used === 1) await this.redis.client.expire(key, 70);
    res.setHeader('X-RateLimit-Limit', String(who.rateLimitPerMinute));
    res.setHeader(
      'X-RateLimit-Remaining',
      String(Math.max(0, who.rateLimitPerMinute - used)),
    );
    res.setHeader('X-RateLimit-Reset', String((minute + 1) * 60));
    if (used > who.rateLimitPerMinute) {
      res.setHeader(
        'Retry-After',
        String(60 - (Math.floor(Date.now() / 1000) % 60)),
      );
      throw new HttpException(
        {
          statusCode: 429,
          code: 'RATE_LIMITED',
          message: 'Too many requests. Slow down and retry.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const scope = this.reflector.getAllAndOverride<ApiScope | undefined>(
      SCOPE,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (scope && !who.scopes.includes(scope))
      throw new ForbiddenException({
        message: `This token does not have the ${scope} scope`,
        code: 'INSUFFICIENT_SCOPE',
      });
    return true;
  }
}

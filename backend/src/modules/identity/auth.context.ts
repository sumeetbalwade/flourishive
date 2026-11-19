import {
  SetMetadata,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AccessClaims } from './token.service.js';

export const IS_PUBLIC = 'isPublic';
/** Marks a route that needs no access token (login, refresh, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export type AuthedRequest = Request & { auth?: AccessClaims };

export const CurrentAuth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AccessClaims => {
    return ctx.switchToHttp().getRequest<AuthedRequest>().auth!;
  },
);

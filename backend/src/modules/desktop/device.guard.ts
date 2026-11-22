import {
  CanActivate,
  ExecutionContext,
  Injectable,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';
import type { DeviceCtx } from '../signing/dsc-jobs.service.js';
import { DeviceService } from './device.service.js';

type DeviceRequest = Request & { device?: DeviceCtx };

/** For the routes the desktop app calls: the paired device's credential is the only way in. */
@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(private readonly devices: DeviceService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<DeviceRequest>();
    req.device = await this.devices.authenticate(req.headers.authorization);
    return true;
  }
}

export const CurrentDevice = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): DeviceCtx =>
    ctx.switchToHttp().getRequest<DeviceRequest>().device!,
);

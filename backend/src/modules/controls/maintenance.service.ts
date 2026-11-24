import type { MaintenanceState } from '@flourishive/schemas';
import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { SettingsService } from '../settings/settings.service.js';

/** Paths that keep working in maintenance: staff, health, verification and what the maintenance page itself needs. */
const OPEN =
  /^\/v1\/(platform(\/|$)|health|public\/verify|public\/brand|public\/maintenance|public\/host|internal\/|support(\/|$))/;

/** The maintenance switch (D-70). Read often, so held in memory for a few seconds. */
@Injectable()
export class MaintenanceService {
  private cache: { at: number; value: MaintenanceState } | null = null;

  constructor(private readonly settings: SettingsService) {}

  async state(): Promise<MaintenanceState> {
    if (this.cache && Date.now() - this.cache.at < 5_000)
      return this.cache.value;
    const v = await this.settings.getPlatform('platform.maintenance');
    const value: MaintenanceState = {
      enabled: v.enabled,
      message: v.message,
      until: v.until,
    };
    this.cache = { at: Date.now(), value };
    return value;
  }

  async set(value: MaintenanceState): Promise<void> {
    await this.settings.setPlatform('platform.maintenance', value);
    this.cache = null;
  }

  /**
   * Company routes answer 503 while maintenance is on. Platform staff routes, health checks and verification stay
   * up, and so do requests carrying a support-session token (staff looking at a company).
   */
  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      if (!req.path.startsWith('/v1/') || OPEN.test(req.path)) return next();
      if (hasSupportClaim(req.headers.authorization)) return next();
      this.state()
        .then((s) => {
          if (!s.enabled) return next();
          res.status(503).json({
            statusCode: 503,
            maintenance: true,
            message:
              s.message ||
              'We are doing some maintenance and will be back shortly.',
            until: s.until,
          });
        })
        .catch(() => next());
    };
  }
}

/** Reads (without trusting) the `support` claim of a bearer token. The route's own guard still verifies it. */
export function hasSupportClaim(header: string | undefined): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const part = header.slice(7).split('.')[1];
  if (!part) return false;
  try {
    const p = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as {
      support?: unknown;
    };
    return Boolean(p.support);
  } catch {
    return false;
  }
}

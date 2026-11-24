import {
  FEATURES,
  type SetupImportResult,
  type TenantExport,
} from '@flourishive/schemas';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import { BrandAssetsService } from '../brand/brand-assets.service.js';
import { BrandService } from '../brand/brand.service.js';
import { SETTINGS } from '../settings/registry.js';
import { SettingsService } from '../settings/settings.service.js';
import { FeaturesService } from './features.service.js';

const MAX_EXPORT_ASSET_BYTES = 5 * 1024 * 1024;
const SLOTS = {
  logoLight: 'LOGO_LIGHT',
  logoDark: 'LOGO_DARK',
  favicon: 'FAVICON',
  panelImage: 'PANEL_IMAGE',
} as const;
/** Settings that belong to one company's own setup, not to copy across. */
const NOT_COPIED = new Set(['domains.primary']);

/** Copies one company's setup into another through a JSON file (D-70). Never secrets, passwords or people. */
@Injectable()
export class TenantTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly brand: BrandService,
    private readonly assets: BrandAssetsService,
    private readonly features: FeaturesService,
  ) {}

  private async tenant(id: string) {
    const t = await runAsSystem(async () =>
      this.prisma.db.tenant.findUnique({ where: { id } }),
    );
    if (!t) throw new NotFoundException('Company not found');
    return t;
  }

  async export(tenantId: string): Promise<TenantExport> {
    const t = await this.tenant(tenantId);
    const db = this.prisma.db;
    const rows = await runInTenant(tenantId, async () => ({
      settings: await db.settingValue.findMany({ where: { scope: 'TENANT' } }),
      templates: await db.emailTemplate.findMany({ where: { tenantId } }),
      rules: await db.notificationRule.findMany(),
      roles: await db.role.findMany(),
      off: await db.tenantFeature.findMany(),
    }));
    const profile = await runAsSystem(async () =>
      db.brandProfile.findFirst({
        where: { scope: 'TENANT', tenantId, status: 'PUBLISHED' },
      }),
    );
    let brand: TenantExport['brand'] = null;
    if (profile) {
      const data = profile.data as Record<string, unknown>;
      const slots = (data.assets ?? {}) as Record<string, string>;
      const assets: NonNullable<TenantExport['brand']>['assets'] = [];
      let total = 0;
      for (const [slot, kind] of Object.entries(SLOTS)) {
        const id = slots[slot];
        if (!id) continue;
        const { row, stream } = await this.assets.open(id);
        const chunks: Buffer[] = [];
        for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
        const buf = Buffer.concat(chunks);
        total += buf.length;
        if (total > MAX_EXPORT_ASSET_BYTES)
          throw new BadRequestException(
            'The brand pictures are over 5 MB together, too large to export',
          );
        assets.push({
          kind,
          mimeType: row.mimeType,
          base64: buf.toString('base64'),
        });
      }
      const { assets: _drop, ...rest } = data;
      void _drop;
      brand = { data: rest, assets };
    }
    return {
      format: 'flourishive-tenant-setup',
      version: 1,
      exportedAt: new Date().toISOString(),
      source: { slug: t.slug, name: t.name },
      settings: Object.fromEntries(
        rows.settings
          .filter((s) => !NOT_COPIED.has(s.key) && s.key in SETTINGS)
          .map((s) => [s.key, s.value]),
      ),
      brand,
      emailTemplates: rows.templates.map((x) => ({
        event: x.event,
        subject: x.subject,
        body: x.body,
      })),
      notificationRules: rows.rules.map((r) => ({
        event: r.event,
        roleKey: r.roleKey,
        channel: r.channel,
        enabled: r.enabled,
      })),
      rolePolicies: rows.roles.map((r) => ({
        roleKey: r.key,
        mfaLevel: r.mfaLevel,
        recoveryEmail: r.recoveryEmail,
        recoveryCodes: r.recoveryCodes,
      })),
      features: Object.fromEntries(
        FEATURES.map((f) => [
          f.key,
          !rows.off.some((o) => o.feature === f.key && !o.enabled),
        ]),
      ),
    };
  }

  /** Previews (dryRun) or applies a file to a company. The preview lists exactly what would change. */
  async import(
    tenantId: string,
    by: string | null,
    file: TenantExport,
    dryRun: boolean,
  ): Promise<SetupImportResult> {
    await this.tenant(tenantId);
    const changes: SetupImportResult['changes'] = [];
    const skipped: string[] = [];
    const db = this.prisma.db;
    const cur = await this.export(tenantId);

    // Settings
    for (const [key, value] of Object.entries(file.settings)) {
      const def = (
        SETTINGS as Record<string, (typeof SETTINGS)[keyof typeof SETTINGS]>
      )[key];
      if (!def || !def.levels.includes('tenant') || NOT_COPIED.has(key)) {
        skipped.push(`Setting ${key} is not copied`);
        continue;
      }
      if (JSON.stringify(cur.settings[key]) === JSON.stringify(value)) continue;
      const parsed = def.schema.safeParse(value);
      if (!parsed.success) {
        skipped.push(`Setting ${key} has a value that is not valid here`);
        continue;
      }
      changes.push({
        area: 'Settings',
        text: `${def.label}: set to ${JSON.stringify(value)}`,
      });
      if (!dryRun)
        await this.settings.set(
          { tenantId, updatedBy: by ?? '' },
          'tenant',
          key,
          value,
        );
    }

    // Email wording
    for (const t of file.emailTemplates) {
      const same = cur.emailTemplates.find((c) => c.event === t.event);
      if (same && same.subject === t.subject && same.body === t.body) continue;
      changes.push({
        area: 'Email wording',
        text: `${t.event}: ${same ? 'changed' : 'added'}`,
      });
      if (!dryRun)
        await runInTenant(tenantId, async () => {
          const existing = await db.emailTemplate.findFirst({
            where: { tenantId, event: t.event },
          });
          if (existing)
            await db.emailTemplate.update({
              where: { id: existing.id },
              data: { subject: t.subject, body: t.body, updatedBy: by },
            });
          else
            await db.emailTemplate.create({
              data: {
                tenantId,
                event: t.event,
                subject: t.subject,
                body: t.body,
                updatedBy: by,
              },
            });
        });
    }

    // Notification rules
    for (const r of file.notificationRules) {
      const same = cur.notificationRules.find(
        (c) =>
          c.event === r.event &&
          c.roleKey === r.roleKey &&
          c.channel === r.channel,
      );
      if (same && same.enabled === r.enabled) continue;
      changes.push({
        area: 'Notifications',
        text: `${r.event} to ${r.roleKey} by ${r.channel}: ${r.enabled ? 'on' : 'off'}`,
      });
      if (!dryRun)
        await runInTenant(tenantId, async () =>
          db.notificationRule.upsert({
            where: {
              tenantId_event_roleKey_channel: {
                tenantId,
                event: r.event,
                roleKey: r.roleKey,
                channel: r.channel as 'EMAIL',
              },
            },
            update: { enabled: r.enabled, updatedBy: by },
            create: {
              tenantId,
              event: r.event,
              roleKey: r.roleKey,
              channel: r.channel as 'EMAIL',
              enabled: r.enabled,
              updatedBy: by,
            },
          }),
        );
    }

    // Role policies (only roles this company has)
    for (const p of file.rolePolicies) {
      const same = cur.rolePolicies.find((c) => c.roleKey === p.roleKey);
      if (!same) {
        skipped.push(`Role ${p.roleKey} does not exist here`);
        continue;
      }
      if (
        same.mfaLevel === p.mfaLevel &&
        same.recoveryEmail === p.recoveryEmail &&
        same.recoveryCodes === p.recoveryCodes
      )
        continue;
      changes.push({
        area: 'Sign-in policy',
        text: `${p.roleKey}: two-step ${p.mfaLevel.toLowerCase()}`,
      });
      if (!dryRun)
        await runInTenant(tenantId, async () =>
          db.role.updateMany({
            where: { key: p.roleKey },
            data: {
              mfaLevel: p.mfaLevel,
              recoveryEmail: p.recoveryEmail,
              recoveryCodes: p.recoveryCodes,
            },
          }),
        );
    }

    // Feature switches
    for (const f of FEATURES) {
      const want = file.features[f.key];
      if (want === undefined || want === cur.features[f.key]) continue;
      changes.push({
        area: 'Features',
        text: `${f.label}: ${want ? 'on' : 'off'}`,
      });
      if (!dryRun) await this.features.set(tenantId, f.key, want, by);
    }

    // Brand: saved as a draft and published, so it can be reverted from the brand editor.
    if (
      file.brand &&
      JSON.stringify({
        d: file.brand.data,
        a: file.brand.assets.map((a) => a.base64.length),
      }) !==
        JSON.stringify({
          d: cur.brand?.data,
          a: cur.brand?.assets.map((a) => a.base64.length),
        })
    ) {
      changes.push({
        area: 'Brand',
        text: `Brand replaced with ${file.source.name}'s published brand`,
      });
      if (!dryRun) {
        const data: Record<string, unknown> = { ...file.brand.data };
        const ids: Record<string, string> = {
          logoLight: '',
          logoDark: '',
          favicon: '',
          panelImage: '',
        };
        for (const a of file.brand.assets) {
          const slot = Object.entries(SLOTS).find(([, k]) => k === a.kind)?.[0];
          if (!slot) continue;
          const up = await this.assets.upload(
            tenantId,
            by,
            a.kind,
            Buffer.from(a.base64, 'base64'),
          );
          ids[slot] = up.id;
        }
        data.assets = ids;
        await this.brand.saveDraft(tenantId, by, data);
        await this.brand.publish(tenantId, by);
      }
    }

    return { dryRun, changes, skipped };
  }
}

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  TemplateListItem,
  TemplateView,
  PreviewResponse,
} from '@flourishive/schemas';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import { Inject } from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import { MailService } from '../../platform/mail/mail.service.js';
import {
  renderEmail,
  validateTemplate,
  type Brand,
  type RenderedMail,
} from './email-renderer.js';
import { BrandService } from '../brand/brand.service.js';
import { accentOf, type BrandData } from '@flourishive/schemas';
import { EMAIL_EVENTS, eventDef, type EmailEventDef } from './events.js';

type Row = {
  id: string;
  subject: string;
  body: string;
  locked: boolean;
  updatedAt: Date;
};

interface Resolved {
  def: EmailEventDef;
  source: 'company' | 'platform' | 'default';
  subject: string;
  body: string;
  locked: boolean;
  updatedAt: Date | null;
}

/**
 * Email wording (D-59). The text of an email is the company's version, else the platform's override, else
 * the built-in default. A platform row can be locked so companies cannot reword that email.
 */
@Injectable()
export class EmailTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly brands: BrandService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  private def(event: string): EmailEventDef {
    const d = eventDef(event);
    if (!d) throw new NotFoundException('No such email');
    return d;
  }

  private platformRow(event: string): Promise<Row | null> {
    return runAsSystem(
      async () =>
        await this.db.emailTemplate.findFirst({
          where: { tenantId: null, event },
        }),
    );
  }

  private tenantRow(tenantId: string, event: string): Promise<Row | null> {
    return runInTenant(
      tenantId,
      async () =>
        await this.db.emailTemplate.findFirst({ where: { tenantId, event } }),
    );
  }

  private async resolve(
    def: EmailEventDef,
    tenantId: string | null,
  ): Promise<Resolved> {
    const platform = await this.platformRow(def.key);
    // A locked platform wording, or an email a company may not reword, beats any company row.
    const tenantMayEdit = def.audience === 'tenant' && def.tenantEditable;
    const locked = platform?.locked ?? false;
    if (tenantId && tenantMayEdit && !locked) {
      const own = await this.tenantRow(tenantId, def.key);
      if (own)
        return {
          def,
          source: 'company',
          subject: own.subject,
          body: own.body,
          locked,
          updatedAt: own.updatedAt,
        };
    }
    if (platform)
      return {
        def,
        source: 'platform',
        subject: platform.subject,
        body: platform.body,
        locked,
        updatedAt: platform.updatedAt,
      };
    return {
      def,
      source: 'default',
      subject: def.subject,
      body: def.body,
      locked,
      updatedAt: null,
    };
  }

  /** The published brand for this company (or the product): name, accent colour, footer. */
  private async brand(
    tenantId: string | null,
    override?: BrandData,
  ): Promise<Brand> {
    const b = override ?? (await this.brands.effective(tenantId));
    return {
      name: b.displayName,
      accent: accentOf(b.theme),
      footerText: b.email.footerText,
      address: b.email.address,
    };
  }

  private sample(def: EmailEventDef): Record<string, string> {
    return Object.fromEntries(def.variables.map((v) => [v.name, v.sample]));
  }

  /**
   * What goes out for an event: the effective wording filled with `vars`. A saved wording that no longer
   * fits (for example after an event gained a required placeholder) falls back to the built-in text, so a
   * code or link email is never sent broken.
   */
  async render(
    event: string,
    tenantId: string | null,
    vars: Record<string, string>,
  ): Promise<RenderedMail> {
    const def = this.def(event);
    const r = await this.resolve(def, tenantId);
    const brand = await this.brand(tenantId);
    const all = { app: brand.name, ...vars };
    const fits = validateTemplate(def, r.subject, r.body).length === 0;
    return renderEmail(
      fits ? r.subject : def.subject,
      fits ? r.body : def.body,
      all,
      brand,
    );
  }

  // ---- screens -------------------------------------------------------

  private view(r: Resolved, forTenant: boolean): TemplateView {
    const readOnly =
      forTenant &&
      (r.def.audience !== 'tenant' || !r.def.tenantEditable || r.locked);
    return {
      event: r.def.key,
      label: r.def.label,
      description: r.def.description,
      source: r.source,
      locked: r.locked,
      readOnly,
      subject: r.subject,
      body: r.body,
      defaultSubject: r.def.subject,
      defaultBody: r.def.body,
      variables: r.def.variables,
      required: r.def.required,
      updatedAt: r.updatedAt?.toISOString() ?? null,
    };
  }

  /** Every email the caller can see, with where its wording comes from. */
  async list(tenantId: string | null): Promise<TemplateListItem[]> {
    const defs = EMAIL_EVENTS.filter(
      (d) => tenantId === null || d.audience === 'tenant',
    );
    const out: TemplateListItem[] = [];
    for (const d of defs) {
      const v = this.view(await this.resolve(d, tenantId), tenantId !== null);
      out.push({
        event: v.event,
        label: v.label,
        description: v.description,
        source: v.source,
        locked: v.locked,
        readOnly: v.readOnly,
        updatedAt: v.updatedAt,
      });
    }
    return out;
  }

  async get(event: string, tenantId: string | null): Promise<TemplateView> {
    const def = this.def(event);
    if (tenantId && def.audience !== 'tenant')
      throw new NotFoundException('No such email');
    return this.view(await this.resolve(def, tenantId), tenantId !== null);
  }

  private check(def: EmailEventDef, subject: string, body: string): void {
    const problems = validateTemplate(def, subject, body);
    if (problems.length) throw new BadRequestException(problems);
  }

  async save(
    event: string,
    tenantId: string | null,
    by: string | null,
    input: { subject: string; body: string; locked?: boolean },
  ): Promise<TemplateView> {
    const def = this.def(event);
    this.check(def, input.subject, input.body);
    if (tenantId) {
      const current = await this.resolve(def, tenantId);
      if (def.audience !== 'tenant' || !def.tenantEditable || current.locked)
        throw new ForbiddenException(
          'The platform has set the wording of this email, so it cannot be changed here',
        );
      const own = await this.tenantRow(tenantId, event);
      await runInTenant(tenantId, async () => {
        if (own)
          await this.db.emailTemplate.update({
            where: { id: own.id },
            data: { subject: input.subject, body: input.body, updatedBy: by },
          });
        else
          await this.db.emailTemplate.create({
            data: {
              tenantId,
              event,
              subject: input.subject,
              body: input.body,
              updatedBy: by,
            },
          });
      });
    } else {
      const own = await this.platformRow(event);
      const locked = input.locked ?? own?.locked ?? false;
      await runAsSystem(async () => {
        if (own)
          await this.db.emailTemplate.update({
            where: { id: own.id },
            data: {
              subject: input.subject,
              body: input.body,
              locked,
              updatedBy: by,
            },
          });
        else
          await this.db.emailTemplate.create({
            data: {
              tenantId: null,
              event,
              subject: input.subject,
              body: input.body,
              locked,
              updatedBy: by,
            },
          });
      });
    }
    return this.get(event, tenantId);
  }

  /** Back to the next level up: a company to the platform's wording, the platform to the built-in text. */
  async reset(event: string, tenantId: string | null): Promise<TemplateView> {
    const def = this.def(event);
    if (tenantId) {
      await runInTenant(tenantId, async () => {
        await this.db.emailTemplate.deleteMany({ where: { tenantId, event } });
      });
    } else {
      await runAsSystem(async () => {
        await this.db.emailTemplate.deleteMany({
          where: { tenantId: null, event },
        });
      });
    }
    return this.get(def.key, tenantId);
  }

  async preview(
    event: string,
    tenantId: string | null,
    input: { subject?: string; body?: string; scheme: 'light' | 'dark' },
    brandOverride?: BrandData,
  ): Promise<PreviewResponse> {
    const def = this.def(event);
    const cur = await this.resolve(def, tenantId);
    const subject = input.subject ?? cur.subject;
    const body = input.body ?? cur.body;
    const problems = validateTemplate(def, subject, body);
    // Render even a draft with problems, using only the placeholders that exist, so typing stays smooth.
    const brand = await this.brand(tenantId, brandOverride);
    const r = renderEmail(
      subject,
      body,
      { app: brand.name, ...this.sample(def) },
      brand,
      input.scheme,
    );
    return { ...r, problems };
  }

  /** Sends the preview to one address (the person who asked). Sample values stand in for real ones. */
  async sendTest(
    event: string,
    tenantId: string | null,
    to: string,
    input: { subject?: string; body?: string },
  ): Promise<void> {
    const def = this.def(event);
    const cur = await this.resolve(def, tenantId);
    const subject = input.subject ?? cur.subject;
    const body = input.body ?? cur.body;
    this.check(def, subject, body);
    const brand = await this.brand(tenantId);
    const r = renderEmail(
      subject,
      body,
      { app: brand.name, ...this.sample(def) },
      brand,
    );
    await this.mail.send({
      event: 'template.test',
      ...(tenantId ? { tenantId } : {}),
      to,
      subject: `[Test] ${r.subject}`,
      text: r.text,
      html: r.html,
    });
  }
}

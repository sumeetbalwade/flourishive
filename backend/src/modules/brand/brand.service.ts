import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  brandPatch,
  mergeBrand,
  type BrandData,
  type BrandEditorState,
  type BrandPatch,
} from '@flourishive/schemas';
import { Inject } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runAsSystem } from '../../platform/database/tenant-context.js';

/**
 * How the product and each company look and sound (D-61, D-62). Each level (the product, or one company)
 * has a DRAFT it edits freely, a PUBLISHED version that people see, and ARCHIVED older versions it can go
 * back to. A company's brand holds only what it changes; the rest is the product's.
 */
@Injectable()
export class BrandService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The built-in layer under everything: the product name from configuration. */
  private get base(): BrandPatch {
    return { displayName: this.config.APP_NAME };
  }

  private get db() {
    return this.prisma.db;
  }

  /** `tenantId` null is the product. Always filtered explicitly, since callers run as the system. */
  private where(
    tenantId: string | null,
    status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED',
  ) {
    return tenantId
      ? { scope: 'TENANT' as const, tenantId, status }
      : { scope: 'PLATFORM' as const, tenantId: null, status };
  }

  private async row(tenantId: string | null, status: 'DRAFT' | 'PUBLISHED') {
    return runAsSystem(
      async () =>
        await this.db.brandProfile.findFirst({
          where: this.where(tenantId, status),
        }),
    );
  }

  private parse(raw: unknown, tenantId: string | null): BrandPatch {
    const r = brandPatch.safeParse(raw);
    if (!r.success) return {};
    // A company cannot set the product's legal links, whatever a stored row says.
    if (tenantId) delete r.data.legal;
    return r.data as BrandPatch;
  }

  /** What people see: the product's published brand, with the company's laid over it. */
  async effective(tenantId: string | null): Promise<BrandData> {
    const platform = await this.row(null, 'PUBLISHED');
    const layers: BrandPatch[] = [this.parse(platform?.data, null)];
    if (tenantId) {
      const own = await this.row(tenantId, 'PUBLISHED');
      layers.push(this.parse(own?.data, tenantId));
    }
    return mergeBrand(this.base, ...layers);
  }

  /**
   * What the app would look like if this draft were published. A draft is the whole set of a level's
   * changes (publishing replaces the published set), so it sits over the product's brand, not over the
   * company's currently published one.
   */
  async withDraft(
    tenantId: string | null,
    draft: BrandPatch,
  ): Promise<BrandData> {
    if (!tenantId) return mergeBrand(this.base, this.parse(draft, null));
    const platform = await this.row(null, 'PUBLISHED');
    return mergeBrand(
      this.base,
      this.parse(platform?.data, null),
      this.parse(draft, tenantId),
    );
  }

  async state(tenantId: string | null): Promise<BrandEditorState> {
    const [platformPub, pub, draft, archived] = await Promise.all([
      tenantId ? this.row(null, 'PUBLISHED') : Promise.resolve(null),
      this.row(tenantId, 'PUBLISHED'),
      this.row(tenantId, 'DRAFT'),
      runAsSystem(
        async () =>
          await this.db.brandProfile.count({
            where: this.where(tenantId, 'ARCHIVED'),
          }),
      ),
    ]);
    const published = pub ? this.parse(pub.data, tenantId) : null;
    const draftPatch = draft ? this.parse(draft.data, tenantId) : null;
    // What this company inherits: the product's published brand over the built-in defaults.
    const inherited = mergeBrand(
      this.base,
      tenantId ? this.parse(platformPub?.data, null) : null,
    );
    return {
      inherited,
      published,
      publishedVersion: pub?.version ?? null,
      publishedAt: pub?.publishedAt?.toISOString() ?? null,
      draft: draftPatch,
      hasDraft: draft !== null,
      canRevert: archived > 0 && pub !== null,
      working: draftPatch
        ? await this.withDraft(tenantId, draftPatch)
        : await this.effective(tenantId),
    };
  }

  /** Saves the draft. The draft is the whole set of changes: groups left out go back to inherited. */
  async saveDraft(
    tenantId: string | null,
    by: string | null,
    raw: unknown,
  ): Promise<BrandEditorState> {
    const parsed = brandPatch.safeParse(raw);
    if (!parsed.success)
      throw new BadRequestException(
        parsed.error.issues.map(
          (i) => `${i.path.join('.') || 'brand'}: ${i.message}`,
        ),
      );
    const data = this.parse(parsed.data, tenantId);
    const current = await this.row(tenantId, 'DRAFT');
    await runAsSystem(async () => {
      if (current)
        await this.db.brandProfile.update({
          where: { id: current.id },
          data: { data: data as never, updatedBy: by },
        });
      else
        await this.db.brandProfile.create({
          data: {
            scope: tenantId ? 'TENANT' : 'PLATFORM',
            tenantId,
            status: 'DRAFT',
            data: data as never,
            updatedBy: by,
          },
        });
    });
    return this.state(tenantId);
  }

  async discardDraft(tenantId: string | null): Promise<BrandEditorState> {
    await runAsSystem(async () => {
      await this.db.brandProfile.deleteMany({
        where: this.where(tenantId, 'DRAFT'),
      });
    });
    return this.state(tenantId);
  }

  /** Makes the draft live. The old published version is kept so it can be brought back. */
  async publish(
    tenantId: string | null,
    by: string | null,
  ): Promise<BrandEditorState> {
    const draft = await this.row(tenantId, 'DRAFT');
    if (!draft) throw new ConflictException('There are no unpublished changes');
    const pub = await this.row(tenantId, 'PUBLISHED');
    await runAsSystem(async () => {
      if (pub)
        await this.db.brandProfile.update({
          where: { id: pub.id },
          data: { status: 'ARCHIVED' },
        });
      await this.db.brandProfile.update({
        where: { id: draft.id },
        data: {
          status: 'PUBLISHED',
          version: (pub?.version ?? 0) + 1,
          publishedBy: by,
          publishedAt: new Date(),
        },
      });
    });
    return this.state(tenantId);
  }

  /** Republishes the previous version as a new version. The one being replaced stays in history. */
  async revert(
    tenantId: string | null,
    by: string | null,
  ): Promise<BrandEditorState> {
    const pub = await this.row(tenantId, 'PUBLISHED');
    const previous = await runAsSystem(
      async () =>
        await this.db.brandProfile.findFirst({
          where: this.where(tenantId, 'ARCHIVED'),
          orderBy: { version: 'desc' },
        }),
    );
    if (!pub || !previous)
      throw new NotFoundException('There is no earlier version to go back to');
    await runAsSystem(async () => {
      await this.db.brandProfile.update({
        where: { id: pub.id },
        data: { status: 'ARCHIVED' },
      });
      await this.db.brandProfile.create({
        data: {
          scope: tenantId ? 'TENANT' : 'PLATFORM',
          tenantId,
          status: 'PUBLISHED',
          version: pub.version + 1,
          data: previous.data as never,
          publishedBy: by,
          publishedAt: new Date(),
        },
      });
    });
    return this.state(tenantId);
  }

  /** The brand a signed-out company page uses, by slug. Null for unknown or suspended companies. */
  async bySlug(slug: string): Promise<BrandData | null> {
    const t = await runAsSystem(
      async () =>
        await this.db.tenant.findUnique({
          where: { slug: slug.toLowerCase() },
        }),
    );
    if (!t || t.status !== 'ACTIVE' || t.slug.startsWith('_')) return null;
    return this.effective(t.id);
  }
}

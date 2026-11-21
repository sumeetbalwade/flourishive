import { BadRequestException, Injectable } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';

const A4 = { w: 595.28, h: 841.89 };

/** Turns a PNG or JPG letterhead into a one-page A4 PDF, scaled to cover the page. */
export async function imageToPdf(
  body: Buffer,
  mime: string,
  orientation: 'PORTRAIT' | 'LANDSCAPE',
): Promise<Buffer> {
  const [w, h] = orientation === 'LANDSCAPE' ? [A4.h, A4.w] : [A4.w, A4.h];
  const pdf = await PDFDocument.create();
  const img =
    mime === 'image/png' ? await pdf.embedPng(body) : await pdf.embedJpg(body);
  if (img.width > img.height !== (orientation === 'LANDSCAPE'))
    throw new BadRequestException(
      `The image is ${img.width > img.height ? 'landscape' : 'portrait'} but you chose ${orientation.toLowerCase()}`,
    );
  const scale = Math.max(w / img.width, h / img.height);
  const page = pdf.addPage([w, h]);
  page.drawImage(img, {
    x: (w - img.width * scale) / 2,
    y: h - img.height * scale,
    width: img.width * scale,
    height: img.height * scale,
  });
  return Buffer.from(await pdf.save());
}
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runInTenant } from '../../platform/database/tenant-context.js';
import { FilesService } from '../files/files.service.js';
import { DocAccess, type Actor } from './doc-access.service.js';

@Injectable()
export class LetterheadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly docAccess: DocAccess,
  ) {}

  async list(a: Actor) {
    const where = await this.docAccess.entityFilter(a, 'documents.read');
    return runInTenant(a.tenantId, async () =>
      this.prisma.db.letterhead.findMany({
        where,
        orderBy: [
          { entityId: 'asc' },
          { orientation: 'asc' },
          { version: 'desc' },
        ],
      }),
    );
  }

  /** The newest version for an entity and orientation, or null. */
  latest(
    tenantId: string,
    entityId: string,
    orientation: 'PORTRAIT' | 'LANDSCAPE',
  ) {
    return runInTenant(tenantId, async () =>
      this.prisma.db.letterhead.findFirst({
        where: { entityId, orientation },
        orderBy: { version: 'desc' },
      }),
    );
  }

  /** Every upload is a new version; older ones stay so issued documents keep their stationery. */
  async add(
    a: { tenantId: string; userId: string },
    input: {
      body: Buffer;
      mimeType?: string;
      entityId: string;
      name: string;
      orientation: 'PORTRAIT' | 'LANDSCAPE';
      marginTop?: number;
      marginBottom?: number;
      marginLeft?: number;
      marginRight?: number;
      stampLeft?: number;
      stampBottom?: number;
    },
  ) {
    await this.docAccess.assert(a, 'documents.manage', input.entityId);
    if (input.mimeType === 'image/png' || input.mimeType === 'image/jpeg') {
      try {
        input.body = await imageToPdf(
          input.body,
          input.mimeType,
          input.orientation,
        );
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
        throw new BadRequestException('That image could not be read');
      }
    }
    if (input.body.subarray(0, 5).toString('latin1') !== '%PDF-')
      throw new BadRequestException('The letterhead must be a PDF');
    let size: { width: number; height: number };
    try {
      const pdf = await PDFDocument.load(input.body);
      if (pdf.getPageCount() < 1) throw new Error('empty');
      size = pdf.getPage(0).getSize();
    } catch {
      throw new BadRequestException('That PDF could not be read');
    }
    const landscape = size.width > size.height;
    if (landscape !== (input.orientation === 'LANDSCAPE'))
      throw new BadRequestException(
        `The PDF page is ${landscape ? 'landscape' : 'portrait'} but you chose ${input.orientation.toLowerCase()}`,
      );
    const entity = await runInTenant(a.tenantId, async () =>
      this.prisma.db.entity.findUnique({
        where: { id: input.entityId },
        select: { id: true },
      }),
    );
    if (!entity) throw new BadRequestException('That company does not exist');
    const file = await this.files.storeTrusted(a, {
      body: input.body,
      mimeType: 'application/pdf',
      name: `${input.name}.pdf`,
      ownerType: 'letterhead',
    });
    const margins: Record<string, number> = {};
    for (const k of [
      'marginTop',
      'marginBottom',
      'marginLeft',
      'marginRight',
      'stampLeft',
      'stampBottom',
    ] as const)
      if (input[k] !== undefined) margins[k] = input[k];
    return runInTenant(a.tenantId, async () => {
      const last = await this.prisma.db.letterhead.findFirst({
        where: { entityId: input.entityId, orientation: input.orientation },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      return this.prisma.db.letterhead.create({
        data: {
          tenantId: a.tenantId,
          entityId: input.entityId,
          orientation: input.orientation,
          name: input.name,
          version: (last?.version ?? 0) + 1,
          fileId: file.id,
          createdBy: a.userId,
          ...margins,
        },
      });
    });
  }
}

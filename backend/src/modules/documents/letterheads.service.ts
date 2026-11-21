import { BadRequestException, Injectable } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runInTenant } from '../../platform/database/tenant-context.js';
import { FilesService } from '../files/files.service.js';

@Injectable()
export class LetterheadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  list(tenantId: string) {
    return runInTenant(tenantId, async () =>
      this.prisma.db.letterhead.findMany({
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
      entityId: string;
      name: string;
      orientation: 'PORTRAIT' | 'LANDSCAPE';
      marginTop?: number;
      marginBottom?: number;
      marginLeft?: number;
      marginRight?: number;
    },
  ) {
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

import { Injectable } from '@nestjs/common';
import { renderToBuffer } from '@react-pdf/renderer';
import { PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import type { BodyProps, Layout } from './layouts/registry.js';

export interface Margins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

@Injectable()
export class PdfService {
  /** Draws the text of a layout on transparent pages. */
  async renderBody(layout: Layout, props: BodyProps): Promise<Buffer> {
    return renderToBuffer(layout.render(props));
  }

  /**
   * Puts the letterhead behind every body page, then stamps the reference, page number and a
   * QR code (pointing at the verify page) in the bottom margin of every page.
   */
  async compose(input: {
    body: Buffer;
    /** Null for uploaded PDFs: they already carry their own stationery. */
    letterhead: Buffer | null;
    reference: string;
    verifyUrl: string;
    margins: Margins;
    /** Points from the left edge (omit to right-align) and from the bottom. */
    stamp?: { left?: number | null; bottom?: number };
  }): Promise<{ bytes: Buffer; pageCount: number }> {
    const out = await PDFDocument.create();
    // A blank stationery page has no content stream, which pdf-lib cannot embed; give it an empty one.
    let lh: Awaited<ReturnType<typeof out.embedPdf>>[number] | undefined;
    if (input.letterhead) {
      const lhDoc = await PDFDocument.load(input.letterhead);
      const lhPage = lhDoc.getPage(0);
      if (!lhPage.node.Contents())
        lhPage.node.set(
          PDFName.of('Contents'),
          lhDoc.context.register(lhDoc.context.stream('')),
        );
      [lh] = await out.embedPdf(lhDoc, [0]);
    }
    const body = await PDFDocument.load(input.body);
    const pages = await out.embedPdf(body, body.getPageIndices());
    const font = await out.embedFont(StandardFonts.Helvetica);
    const qr = await out.embedPng(
      await QRCode.toBuffer(input.verifyUrl, {
        margin: 0,
        width: 180,
        errorCorrectionLevel: 'M',
      }),
    );
    const total = pages.length;
    pages.forEach((bp, i) => {
      const page = out.addPage([bp.width, bp.height]);
      if (lh)
        page.drawPage(lh, { x: 0, y: 0, width: bp.width, height: bp.height });
      page.drawPage(bp, { x: 0, y: 0 });
      const size = 36;
      const bottom = input.stamp?.bottom ?? 22;
      const left = input.stamp?.left;
      const grey = rgb(0.35, 0.35, 0.35);
      const l1 = input.reference;
      const l2 = `Page ${i + 1} of ${total}  |  Scan to verify`;
      if (left == null) {
        const x = bp.width - input.margins.right - size;
        page.drawImage(qr, { x, y: bottom, width: size, height: size });
        const w = Math.max(
          font.widthOfTextAtSize(l1, 7),
          font.widthOfTextAtSize(l2, 7),
        );
        page.drawText(l1, {
          x: x - 8 - w,
          y: bottom + 22,
          size: 7,
          font,
          color: grey,
        });
        page.drawText(l2, {
          x: x - 8 - w,
          y: bottom + 10,
          size: 7,
          font,
          color: grey,
        });
      } else {
        page.drawImage(qr, { x: left, y: bottom, width: size, height: size });
        page.drawText(l1, {
          x: left + size + 8,
          y: bottom + 22,
          size: 7,
          font,
          color: grey,
        });
        page.drawText(l2, {
          x: left + size + 8,
          y: bottom + 10,
          size: 7,
          font,
          color: grey,
        });
      }
    });
    out.setTitle(input.reference);
    out.setProducer('Flourishive');
    const bytes = Buffer.from(await out.save());
    return { bytes, pageCount: total };
  }
}

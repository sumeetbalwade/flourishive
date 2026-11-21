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
    letterhead: Buffer;
    reference: string;
    verifyUrl: string;
    margins: Margins;
  }): Promise<{ bytes: Buffer; pageCount: number }> {
    const out = await PDFDocument.create();
    // A blank stationery page has no content stream, which pdf-lib cannot embed; give it an empty one.
    const lhDoc = await PDFDocument.load(input.letterhead);
    const lhPage = lhDoc.getPage(0);
    if (!lhPage.node.Contents())
      lhPage.node.set(
        PDFName.of('Contents'),
        lhDoc.context.register(lhDoc.context.stream('')),
      );
    const [lh] = await out.embedPdf(lhDoc, [0]);
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
      page.drawPage(lh!, { x: 0, y: 0, width: bp.width, height: bp.height });
      page.drawPage(bp, { x: 0, y: 0 });
      const size = 36;
      const x = bp.width - input.margins.right - size;
      page.drawImage(qr, { x, y: 22, width: size, height: size });
      const label = `${input.reference}  |  Page ${i + 1} of ${total}  |  Verify: scan the code`;
      const w = font.widthOfTextAtSize(label, 7);
      page.drawText(label, {
        x: x - 8 - w,
        y: 36,
        size: 7,
        font,
        color: rgb(0.35, 0.35, 0.35),
      });
    });
    out.setTitle(input.reference);
    out.setProducer('Flourishive');
    const bytes = Buffer.from(await out.save());
    return { bytes, pageCount: total };
  }
}

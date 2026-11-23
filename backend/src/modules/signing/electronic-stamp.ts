import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const ist = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d) + ' IST';

/** Helvetica cannot draw every script; anything else becomes "?" rather than breaking the signing. */
const latin = (s: string) => s.replace(/[^\x20-\x7e]/g, '?');

/**
 * The visible mark for a letter signed without a certificate token: a box with a green tick, the
 * signer's name and the time. It says plainly that no digital signature certificate was used.
 * `box` is [x1, y1, x2, y2] in points from the bottom left of the page.
 */
export async function drawElectronicStamp(
  pdf: PDFDocument,
  p: { page: number; box: number[]; signer: string; at: Date },
): Promise<void> {
  const page = pdf.getPage(p.page);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [x1, y1, x2, y2] = p.box as [number, number, number, number];
  const green = rgb(0.13, 0.55, 0.28);
  page.drawRectangle({
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
    borderColor: green,
    borderWidth: 0.8,
    color: rgb(0.97, 0.99, 0.97),
  });
  // the tick
  const cx = x1 + 14;
  const cy = (y1 + y2) / 2;
  page.drawLine({
    start: { x: cx - 6, y: cy },
    end: { x: cx - 2, y: cy - 5 },
    thickness: 2,
    color: green,
  });
  page.drawLine({
    start: { x: cx - 2, y: cy - 5 },
    end: { x: cx + 7, y: cy + 6 },
    thickness: 2,
    color: green,
  });
  const left = x1 + 28;
  const top = y2 - 11;
  page.drawText('Signed electronically', {
    x: left,
    y: top,
    size: 8,
    font: bold,
    color: green,
  });
  page.drawText(latin(p.signer).slice(0, 38), {
    x: left,
    y: top - 11,
    size: 8,
    font: bold,
    color: rgb(0.1, 0.1, 0.1),
  });
  page.drawText(ist(p.at), {
    x: left,
    y: top - 21,
    size: 6.5,
    font,
    color: rgb(0.3, 0.3, 0.3),
  });
  page.drawText('Without a digital signature certificate', {
    x: left,
    y: top - 30,
    size: 5.5,
    font,
    color: rgb(0.45, 0.45, 0.45),
  });
}

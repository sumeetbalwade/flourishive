const A4 = { w: 595.28, h: 841.89 };
export const STAMP_SIZE = { w: 214, h: 48 };

/**
 * Where the visible signature stamp goes: on the first page, just above the reference and QR
 * stamp, in the same horizontal position (so a letterhead that keeps that corner clear for the QR
 * also keeps it clear for the signature). Points from the bottom left of the page.
 */
export function signatureBox(l: {
  orientation: 'PORTRAIT' | 'LANDSCAPE';
  marginRight: number;
  stampLeft: number | null;
  stampBottom: number;
}) {
  const width = l.orientation === 'LANDSCAPE' ? A4.h : A4.w;
  const x1 = l.stampLeft ?? width - l.marginRight - STAMP_SIZE.w;
  const y1 = l.stampBottom + 36 + 12; // the QR stamp is 36 points tall
  return {
    visible: true,
    page: 0,
    box: [x1, y1, x1 + STAMP_SIZE.w, y1 + STAMP_SIZE.h].map(
      (n) => Math.round(n * 100) / 100,
    ),
    style: 'tick',
  };
}

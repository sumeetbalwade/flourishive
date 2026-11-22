/** One signature in a PDF: the byte ranges it covers and the raw signature bytes (DER CMS). */
export interface PdfSignature {
  /** Where the covered bytes end: the signature protects everything before this offset. */
  coveredEnd: number;
  a: number;
  b: number;
  c: number;
  d: number;
  contents: Buffer;
}

/** Every signature in the file, in the order they were added (oldest first). */
export function findSignatures(pdf: Buffer): PdfSignature[] {
  const text = pdf.toString('latin1');
  const out: PdfSignature[] = [];
  let at = text.indexOf('/ByteRange');
  while (at >= 0) {
    const m = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(
      text.slice(at, at + 200),
    );
    if (m) {
      const [a, b, c, d] = m.slice(1).map(Number) as [
        number,
        number,
        number,
        number,
      ];
      const hex = /<([0-9a-fA-F]+)>/.exec(text.slice(a + b, c))?.[1];
      if (hex && a === 0 && c + d <= pdf.length)
        out.push({
          coveredEnd: c + d,
          a,
          b,
          c,
          d,
          contents: Buffer.from(hex, 'hex'),
        });
    }
    at = text.indexOf('/ByteRange', at + 10);
  }
  return out.sort((x, y) => x.coveredEnd - y.coveredEnd);
}

/** The bytes a signature actually covers (everything except its own signature value). */
export function coveredBytes(pdf: Buffer, s: PdfSignature): Buffer {
  return Buffer.concat([
    pdf.subarray(s.a, s.a + s.b),
    pdf.subarray(s.c, s.c + s.d),
  ]);
}

/**
 * Checks that bytes appended to a signed file only add a signature (its dictionary, field and
 * the catalogue/page entries that point at it), so an earlier signature is still valid in the
 * sense that matters: nothing visible was changed. Anything else, such as a new content
 * stream, an annotation or an object stream (which hides its contents), is a modification.
 */
export function onlyAddsSignature(appended: Buffer): {
  ok: boolean;
  reason?: string;
} {
  const text = appended.toString('latin1');
  const objects = [
    ...text.matchAll(/(\d+)\s+(\d+)\s+obj\b([\s\S]*?)\bendobj\b/g),
  ];
  if (!objects.length)
    return { ok: false, reason: 'No objects in the added part' };
  let sawSignature = false;
  for (const o of objects) {
    const body = o[3]!;
    const isSig = /\/Type\s*\/Sig\b/.test(body) || /\/ByteRange/.test(body);
    const isWidget =
      /\/Subtype\s*\/Widget\b/.test(body) && /\/FT\s*\/Sig\b/.test(body);
    const isCatalog = /\/Type\s*\/Catalog\b/.test(body);
    const isPage = /\/Type\s*\/Page\b/.test(body);
    const isXref = /\/Type\s*\/XRef\b/.test(body);
    const isAppearance = /\/Subtype\s*\/Form\b/.test(body);
    const isAcroForm = /\/Fields\s*\[/.test(body);
    // resources a signature appearance needs, and the document information entry (modified date)
    const isFont = /\/Type\s*\/Font(Descriptor)?\b/.test(body);
    const isInfo =
      !/\/Type\b/.test(body) &&
      /\/(Producer|ModDate|CreationDate)\b/.test(body);
    const isPlain = !/<<|stream/.test(body);
    if (isSig || isWidget) sawSignature = true;
    if (/\/Type\s*\/ObjStm\b/.test(body))
      return { ok: false, reason: 'Hidden object stream added' };
    if (
      /\/Subtype\s*\/(Text|FreeText|Stamp|Highlight|Underline|StrikeOut|Link|Square|Circle|Line|Ink|Popup|FileAttachment|Redact)\b/.test(
        body,
      )
    )
      return { ok: false, reason: 'An annotation was added' };
    if (/\bstream\b/.test(body) && !isXref && !isAppearance)
      return { ok: false, reason: 'New page content was added' };
    if (!(
      isSig ||
      isWidget ||
      isCatalog ||
      isPage ||
      isXref ||
      isAppearance ||
      isAcroForm ||
      isFont ||
      isInfo ||
      isPlain
    ))
      return { ok: false, reason: 'An unexpected object was added' };
  }
  return sawSignature
    ? { ok: true }
    : { ok: false, reason: 'No signature in the added part' };
}

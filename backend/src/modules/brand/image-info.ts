/**
 * Reads the real type and size of a PNG, JPEG or WebP from its bytes. The Content-Type a browser sends is
 * only a claim; this is what decides whether a file is accepted. Anything else (including SVG, which can
 * carry script) returns null.
 */
export interface ImageInfo {
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
}

const u32be = (b: Buffer, o: number) => b.readUInt32BE(o);

export function readImageInfo(b: Buffer): ImageInfo | null {
  // PNG: signature, then the IHDR chunk holds the size.
  if (
    b.length >= 24 &&
    b
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    b.subarray(12, 16).toString('ascii') === 'IHDR'
  )
    return { mime: 'image/png', width: u32be(b, 16), height: u32be(b, 20) };

  // JPEG: walk the segments to the first start-of-frame marker.
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) return null;
      const marker = b[o + 1]!;
      if (
        marker === 0xd8 ||
        (marker >= 0xd0 && marker <= 0xd7) ||
        marker === 0x01
      ) {
        o += 2;
        continue;
      }
      const len = b.readUInt16BE(o + 2);
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      )
        return {
          mime: 'image/jpeg',
          height: b.readUInt16BE(o + 5),
          width: b.readUInt16BE(o + 7),
        };
      o += 2 + len;
    }
    return null;
  }

  // WebP: RIFF....WEBP, then a VP8 (lossy), VP8L (lossless) or VP8X (extended) chunk.
  if (
    b.length >= 30 &&
    b.subarray(0, 4).toString('ascii') === 'RIFF' &&
    b.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    const fmt = b.subarray(12, 16).toString('ascii');
    if (fmt === 'VP8X')
      return {
        mime: 'image/webp',
        width: 1 + b.readUIntLE(24, 3),
        height: 1 + b.readUIntLE(27, 3),
      };
    if (fmt === 'VP8L' && b[20] === 0x2f) {
      const bits = b.readUInt32LE(21);
      return {
        mime: 'image/webp',
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    if (fmt === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a)
      return {
        mime: 'image/webp',
        width: b.readUInt16LE(26) & 0x3fff,
        height: b.readUInt16LE(28) & 0x3fff,
      };
  }
  return null;
}

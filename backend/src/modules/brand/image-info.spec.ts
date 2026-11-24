import { describe, expect, it } from 'vitest';
import { readImageInfo } from './image-info.js';

const png = (w: number, h: number) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};

describe('readImageInfo', () => {
  it('reads a PNG', () => {
    expect(readImageInfo(png(120, 40))).toEqual({
      mime: 'image/png',
      width: 120,
      height: 40,
    });
  });

  it('reads a JPEG', () => {
    const b = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b,
      0x08, 0x00, 0x30, 0x00, 0x50, 0x01, 0x01, 0x11, 0x00,
    ]);
    expect(readImageInfo(b)).toEqual({
      mime: 'image/jpeg',
      width: 80,
      height: 48,
    });
  });

  it('reads a lossless WebP', () => {
    const b = Buffer.alloc(30);
    b.write('RIFF', 0, 'ascii');
    b.write('WEBP', 8, 'ascii');
    b.write('VP8L', 12, 'ascii');
    b[20] = 0x2f;
    b.writeUInt32LE(63 | (31 << 14), 21);
    expect(readImageInfo(b)).toEqual({
      mime: 'image/webp',
      width: 64,
      height: 32,
    });
  });

  it('refuses SVG, HTML and a renamed program', () => {
    expect(
      readImageInfo(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
      ),
    ).toBeNull();
    expect(readImageInfo(Buffer.from('<html></html>'))).toBeNull();
    expect(
      readImageInfo(Buffer.from('MZ\x90\x00\x03'.padEnd(40, '\0'))),
    ).toBeNull();
  });
});

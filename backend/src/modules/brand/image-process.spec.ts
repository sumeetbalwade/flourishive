import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { processImage, sanitizeSvg, toIco } from './image-process.js';

const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 4, background: '#1f6fb2' } })
    .png()
    .toBuffer();

describe('sanitizeSvg', () => {
  const hostile = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" onload="alert(1)">
       <script>alert(1)</script>
       <foreignObject><iframe src="https://evil.test"></iframe></foreignObject>
       <a href="javascript:alert(1)"><rect width="10" height="10" onclick="x()" style="fill:red"/></a>
       <use href="https://evil.test/x.svg#a"/>
       <circle cx="50" cy="50" r="40" fill="#1f6fb2"/>
     </svg>`,
  );

  it('removes script, handlers, links and embedded pages but keeps shapes', () => {
    const { svg, width, height } = sanitizeSvg(hostile);
    expect(svg).not.toMatch(
      /script|onload|onclick|foreignObject|iframe|javascript:|evil\.test|<use|<a[ >]/i,
    );
    expect(svg).toContain('<circle');
    expect([width, height]).toEqual([200, 100]);
  });
});

describe('processImage', () => {
  it('shrinks a large logo to 512 px and never enlarges a small one', async () => {
    const big = await processImage('LOGO_LIGHT', await png(3000, 1000));
    expect([big.mime, big.width, big.height]).toEqual(['image/png', 512, 171]);
    const small = await processImage('LOGO_LIGHT', await png(100, 40));
    expect([small.width, small.height]).toEqual([100, 40]);
  });

  it('makes the favicon a 64 px square PNG', async () => {
    const f = await processImage('FAVICON', await png(300, 100));
    expect([f.mime, f.width, f.height]).toEqual(['image/png', 64, 64]);
  });

  it('turns the sign-in picture into WebP', async () => {
    const p = await processImage('PANEL_IMAGE', await png(3000, 2000));
    expect([p.mime, p.width]).toEqual(['image/webp', 2000]);
  });

  it('refuses a file that is not a picture', async () => {
    await expect(
      processImage('LOGO_LIGHT', Buffer.from('<html>hi</html>')),
    ).rejects.toThrow();
    await expect(
      processImage('LOGO_LIGHT', Buffer.from('MZ'.padEnd(64, '\0'))),
    ).rejects.toThrow();
  });
});

describe('toIco', () => {
  it('wraps a 32 px PNG in an icon file', async () => {
    const ico = await toIco(await png(64, 64));
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(1);
    expect(ico.subarray(22, 26)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });
});

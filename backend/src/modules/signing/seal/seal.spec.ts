import { PDFDocument } from 'pdf-lib';
import { SealService } from './seal.service.js';

const config = { NODE_ENV: 'test', APP_NAME: 'Flourishive' } as never;

async function samplePdf() {
  const d = await PDFDocument.create();
  const p = d.addPage([300, 300]);
  p.drawText('Offer of internship. Stipend Rs 15,000', { x: 20, y: 200 });
  return Buffer.from(await d.save({ useObjectStreams: false }));
}

describe('organisation seal', () => {
  const seal = new SealService(config);

  it('seals a PDF and verifies it as intact and ours', async () => {
    const sealed = await seal.seal(await samplePdf(), { reason: 'test' });
    const c = seal.verify(sealed);
    expect(c).toMatchObject({
      intact: true,
      coversWholeFile: true,
      sealedByUs: true,
      timestamp: null,
    });
  });

  it('detects a changed byte in the covered content', async () => {
    const sealed = await seal.seal(await samplePdf(), { reason: 'test' });
    const bad = Buffer.from(sealed);
    const i = bad.indexOf('stream\n') + 8; // inside the first content stream
    expect(i).toBeGreaterThan(8);
    bad[i] = bad[i]! ^ 1;
    expect(seal.verify(bad).intact).toBe(false);
  });

  it('detects an edit saved on top of the sealed file', async () => {
    const sealed = await seal.seal(await samplePdf(), { reason: 'test' });
    const extended = Buffer.concat([sealed, Buffer.from('\n%edited later\n')]);
    const c = seal.verify(extended);
    expect(c.coversWholeFile).toBe(false);
  });

  it('does not accept a seal made with a different key', async () => {
    const other = new SealService(config);
    const sealed = await other.seal(await samplePdf(), { reason: 'x' });
    // a second service has its own temporary key, so the first must not claim it
    expect(seal.verify(sealed).sealedByUs).toBe(false);
    expect(seal.verify(sealed).intact).toBe(true);
  });

  it('reports a PDF with no seal', async () => {
    expect(seal.verify(await samplePdf()).intact).toBe(false);
  });
});

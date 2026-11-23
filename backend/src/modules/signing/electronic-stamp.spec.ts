import { PDFDocument } from 'pdf-lib';
import { drawElectronicStamp } from './electronic-stamp.js';
import { SealService } from './seal/seal.service.js';

describe('signing without a token', () => {
  it('stamps the letter, then the seal verifies as intact over the stamped file', async () => {
    const d = await PDFDocument.create();
    d.addPage([595.28, 841.89]);
    const before = Buffer.from(await d.save({ useObjectStreams: false }));
    const pdf = await PDFDocument.load(before);
    // a name Helvetica cannot draw must not break signing
    await drawElectronicStamp(pdf, {
      page: 0,
      box: [350, 70, 564, 118],
      signer: 'Asha Rao (आशा)',
      at: new Date('2026-11-22T10:00:00Z'),
    });
    const stamped = Buffer.from(await pdf.save({ useObjectStreams: false }));
    expect(stamped.length).toBeGreaterThan(before.length);

    const seal = new SealService({
      NODE_ENV: 'test',
      APP_NAME: 'Flourishive',
    } as never);
    const sealed = await seal.seal(stamped, {
      reason: 'Signed electronically by Asha Rao (no DSC)',
    });
    expect(seal.verify(sealed)).toMatchObject({
      intact: true,
      coversWholeFile: true,
      sealedByUs: true,
    });
  });
});

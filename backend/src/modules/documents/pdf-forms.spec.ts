import { PDFDocument } from 'pdf-lib';
import { fillAndFlatten, inspectPdf } from './pdf-forms.js';

async function fillable() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const form = pdf.getForm();
  const name = form.createTextField('Candidate Name');
  name.addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
  const agree = form.createCheckBox('Agreed');
  agree.addToPage(page, { x: 50, y: 650, width: 15, height: 15 });
  return Buffer.from(await pdf.save());
}

describe('uploaded PDF templates', () => {
  it('lists the form fields of a fillable PDF and none for a plain one', async () => {
    const info = await inspectPdf(await fillable());
    expect(info).toMatchObject({ pageCount: 1, landscape: false });
    expect(info.fields).toEqual([
      { name: 'Candidate Name', type: 'text' },
      { name: 'Agreed', type: 'checkbox' },
    ]);
    const plain = await PDFDocument.create();
    plain.addPage([842, 595]);
    const p = await inspectPdf(Buffer.from(await plain.save()));
    expect(p).toMatchObject({ landscape: true, fields: [] });
  });

  it('refuses things that are not a readable PDF', async () => {
    await expect(inspectPdf(Buffer.from('hello'))).rejects.toThrow('not a PDF');
    await expect(inspectPdf(Buffer.from('%PDF-1.4 broken'))).rejects.toThrow();
  });

  it('fills the mapped fields and flattens the form', async () => {
    const out = await fillAndFlatten(
      await fillable(),
      { 'Candidate Name': 'recipientName', Agreed: 'agree' },
      { recipientName: 'Asha Rao', agree: 'yes' },
    );
    const pdf = await PDFDocument.load(out);
    expect(pdf.getForm().getFields()).toHaveLength(0);
    expect(pdf.getPageCount()).toBe(1);
  });
});

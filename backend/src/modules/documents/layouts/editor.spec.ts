import { renderToBuffer } from '@react-pdf/renderer';
import { PDFDocument } from 'pdf-lib';
import { editorDocString, editorLayout } from './editor.js';

const doc = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1, textAlign: 'center' },
      content: [{ type: 'text', text: 'Offer' }],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Dear {{recipientName}}, ',
          marks: [{ type: 'bold' }],
        },
        { type: 'text', text: 'welcome.' },
      ],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableHeader',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Item' }],
                },
              ],
            },
            {
              type: 'tableHeader',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Amount' }],
                },
              ],
            },
          ],
        },
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Stipend' }],
                },
              ],
            },
            {
              type: 'tableCell',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: '{{stipend}}' }],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'One' }] },
          ],
        },
      ],
    },
    { type: 'signatureBox', attrs: { name: '{{signer}}', title: 'HR Lead' } },
  ],
};

describe('visual editor layout', () => {
  it('accepts allowed nodes and refuses others or broken JSON', () => {
    expect(editorDocString.safeParse(JSON.stringify(doc)).success).toBe(true);
    expect(editorDocString.safeParse('not json').success).toBe(false);
    expect(
      editorDocString.safeParse(
        JSON.stringify({ type: 'doc', content: [{ type: 'script' }] }),
      ).success,
    ).toBe(false);
    expect(
      editorDocString.safeParse(JSON.stringify({ type: 'paragraph' })).success,
    ).toBe(false);
  });

  it('draws a PDF with the values filled in', async () => {
    const element = editorLayout.render({
      content: { doc: JSON.stringify(doc) },
      orientation: 'PORTRAIT',
      margins: { top: 100, bottom: 80, left: 60, right: 60 },
      values: {
        recipientName: 'Asha Rao',
        stipend: '10,000',
        signer: 'Meera Shah',
      },
    });
    const bytes = await renderToBuffer(element);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-');
  });
});

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TemplateEditor } from './TemplateEditor.tsx';

// jsdom has no layout; ProseMirror asks for rectangles when it scrolls to the cursor.
const rect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  toJSON: () => ({}),
};
for (const proto of [Element.prototype, Range.prototype] as {
  getClientRects?: unknown;
  getBoundingClientRect?: unknown;
}[]) {
  proto.getClientRects = () => ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: [][Symbol.iterator],
  });
  proto.getBoundingClientRect = () => rect;
}

const start = JSON.stringify({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
});
const ALLOWED = new Set([
  'doc',
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'hardBreak',
  'horizontalRule',
  'signatureBox',
  'text',
]);
const types = (n: { type: string; content?: unknown[] }): string[] => [
  n.type,
  ...((n.content ?? []) as { type: string; content?: unknown[] }[]).flatMap(types),
];

describe('TemplateEditor', () => {
  it('builds tables, a signature box and fields using only nodes the PDF engine can draw', async () => {
    const onChange = vi.fn();
    render(
      <TemplateEditor
        value={start}
        onChange={onChange}
        fields={[{ key: 'recipientName', label: 'Recipient name' }]}
      />,
    );
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Signature box' }));
      await user.click(screen.getByRole('button', { name: 'Table' }));
      await user.click(screen.getByRole('button', { name: 'Bold' }));
      await user.selectOptions(screen.getByLabelText('Insert a field'), 'recipientName');
    });
    // the cursor is now inside the table, where a signature box is not offered
    expect(screen.getByRole('button', { name: 'Signature box' })).toBeDisabled();
    const last = onChange.mock.calls.at(-1)?.[0] as string;
    const doc = JSON.parse(last) as { type: string; content: unknown[] };
    console.log(last);
    const used = new Set(types(doc as never));
    expect(used.has('table')).toBe(true);
    expect(used.has('signatureBox')).toBe(true);
    expect(last).toContain('{{recipientName}}');
    for (const t of used) expect(ALLOWED.has(t), `node ${t} is not drawable`).toBe(true);
  });
});

import { Node, mergeAttributes } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { Input } from '@flourishive/ui';
import { useEffect, useState } from 'react';

/** A line for a signature with the signer's name and title under it. Both can use {{fields}}. */
const SignatureBox = Node.create({
  name: 'signatureBox',
  group: 'block',
  atom: true,
  addAttributes() {
    return { name: { default: '' }, title: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-signature-box]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-signature-box': '',
        class: 'my-3 w-56 border-b border-line-strong pb-1 pt-10 text-xs text-muted',
      }),
      `Signature · ${node.attrs.name || 'name'} · ${node.attrs.title || 'title'}`,
    ];
  },
});

const extensions = [
  StarterKit.configure({
    // Only what the PDF engine can draw (see layouts/editor.tsx on the server).
    italic: false,
    strike: false,
    code: false,
    codeBlock: false,
    blockquote: false,
    link: false,
    heading: { levels: [1, 2, 3] },
  }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  SignatureBox,
];

interface Props {
  /** The editor JSON as text. */
  value: string;
  onChange: (json: string) => void;
  fields: { key: string; label: string }[];
}

const btn =
  'rounded-card border border-line px-2.5 py-1 text-xs hover:bg-surface-2 disabled:opacity-40 data-[on=true]:bg-accent data-[on=true]:text-on-accent';

/** Rich-text editor for letter wording: headings, lists, tables, a signature box and {{field}} placeholders. */
export function TemplateEditor({ value, onChange, fields }: Props) {
  const [, tick] = useState(0);
  const editor = useEditor({
    extensions,
    content: JSON.parse(value) as object,
    onUpdate: ({ editor: e }) => onChange(JSON.stringify(e.getJSON())),
    onSelectionUpdate: () => tick((n) => n + 1),
    editorProps: {
      attributes: {
        class:
          'min-h-[320px] rounded-card border border-line-strong bg-surface-2 p-5 text-sm leading-relaxed focus:outline-none [&_table]:w-full [&_td]:border [&_td]:border-line-strong [&_td]:p-2 [&_th]:border [&_th]:border-line-strong [&_th]:bg-surface [&_th]:p-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold',
      },
    },
  });
  useEffect(() => () => editor?.destroy(), [editor]);
  if (!editor) return null;

  const c = () => editor.chain().focus();
  const on = (name: string, attrs?: object) => editor.isActive(name, attrs);
  const sig = editor.isActive('signatureBox') ? editor.getAttributes('signatureBox') : null;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Formatting">
        <button
          type="button"
          className={btn}
          data-on={on('bold')}
          onClick={() => c().toggleBold().run()}
        >
          Bold
        </button>
        <button
          type="button"
          className={btn}
          data-on={on('underline')}
          onClick={() => c().toggleUnderline().run()}
        >
          Underline
        </button>
        {[1, 2, 3].map((level) => (
          <button
            key={level}
            type="button"
            className={btn}
            data-on={on('heading', { level })}
            onClick={() =>
              c()
                .toggleHeading({ level: level as 1 | 2 | 3 })
                .run()
            }
          >
            H{level}
          </button>
        ))}
        <button
          type="button"
          className={btn}
          data-on={on('bulletList')}
          onClick={() => c().toggleBulletList().run()}
        >
          Bullets
        </button>
        <button
          type="button"
          className={btn}
          data-on={on('orderedList')}
          onClick={() => c().toggleOrderedList().run()}
        >
          Numbers
        </button>
        {(['left', 'center', 'right', 'justify'] as const).map((a) => (
          <button
            key={a}
            type="button"
            className={btn}
            data-on={editor.isActive({ textAlign: a })}
            onClick={() => c().setTextAlign(a).run()}
          >
            {a[0]!.toUpperCase() + a.slice(1)}
          </button>
        ))}
        <button
          type="button"
          className={btn}
          onClick={() => c().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()}
        >
          Table
        </button>
        {on('table') ? (
          <>
            <button type="button" className={btn} onClick={() => c().addRowAfter().run()}>
              + Row
            </button>
            <button type="button" className={btn} onClick={() => c().addColumnAfter().run()}>
              + Column
            </button>
            <button type="button" className={btn} onClick={() => c().deleteRow().run()}>
              − Row
            </button>
            <button type="button" className={btn} onClick={() => c().deleteColumn().run()}>
              − Column
            </button>
            <button type="button" className={btn} onClick={() => c().deleteTable().run()}>
              Delete table
            </button>
          </>
        ) : null}
        <button type="button" className={btn} onClick={() => c().setHorizontalRule().run()}>
          Line
        </button>
        <button
          type="button"
          className={btn}
          onClick={() =>
            c()
              .insertContent({ type: 'signatureBox', attrs: { name: '', title: 'HR Lead' } })
              .run()
          }
        >
          Signature box
        </button>
        <select
          aria-label="Insert a field"
          className={btn}
          value=""
          onChange={(e) => {
            if (e.target.value) c().insertContent(`{{${e.target.value}}}`).run();
          }}
        >
          <option value="">Insert field…</option>
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
          <option value="reference">Reference number</option>
          <option value="issueDate">Issue date</option>
        </select>
      </div>
      {sig ? (
        <div className="grid gap-2 rounded-card border border-line p-3 sm:grid-cols-2">
          <Input
            aria-label="Signer name (can use {{fields}})"
            placeholder="Signer name"
            value={String(sig.name ?? '')}
            onChange={(e) => c().updateAttributes('signatureBox', { name: e.target.value }).run()}
          />
          <Input
            aria-label="Signer title"
            placeholder="Signer title"
            value={String(sig.title ?? '')}
            onChange={(e) => c().updateAttributes('signatureBox', { title: e.target.value }).run()}
          />
        </div>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}

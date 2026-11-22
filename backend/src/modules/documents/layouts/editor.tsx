import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ReactElement, ReactNode } from 'react';
import { z } from 'zod';
import { fill } from '../fill.js';
import { registerFonts } from './fonts.js';
import type { BodyProps, Layout } from './registry.js';

/**
 * The visual editor saves a document as Tiptap JSON. Only these nodes and marks are allowed, so what
 * HR can build is exactly what the PDF engine can draw.
 */
const NODE_TYPES = [
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
] as const;

export interface EditorNode {
  type: (typeof NODE_TYPES)[number];
  attrs?: Record<string, unknown>;
  content?: EditorNode[];
  text?: string;
  marks?: { type: 'bold' | 'underline' }[];
}

const nodeSchema: z.ZodType<EditorNode> = z.lazy(() =>
  z.object({
    type: z.enum(NODE_TYPES),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(nodeSchema).max(500).optional(),
    text: z.string().max(10_000).optional(),
    marks: z
      .array(z.object({ type: z.enum(['bold', 'underline']) }))
      .max(2)
      .optional(),
  }),
);

/** The `doc` field holds the editor JSON as text; this checks it parses and uses only allowed nodes. */
export const editorDocString = z
  .string()
  .max(200_000)
  .refine((s) => {
    try {
      const parsed = nodeSchema.safeParse(JSON.parse(s));
      return parsed.success && parsed.data.type === 'doc';
    } catch {
      return false;
    }
  }, 'The document is not valid');

const STARTER_DOC = JSON.stringify({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Dear {{recipientName}},' }],
    },
    { type: 'paragraph' },
  ],
});

type Values = Record<string, string>;

function inline(node: EditorNode, values: Values, key: number): ReactNode {
  if (node.type === 'hardBreak') return '\n';
  if (node.type !== 'text') return null;
  const bold = node.marks?.some((m) => m.type === 'bold');
  const underline = node.marks?.some((m) => m.type === 'underline');
  return (
    <Text
      key={key}
      style={{
        ...(bold ? { fontWeight: 700 } : {}),
        ...(underline ? { textDecoration: 'underline' } : {}),
      }}
    >
      {fill(node.text ?? '', values)}
    </Text>
  );
}

const alignOf = (n: EditorNode) => {
  const a = n.attrs?.textAlign;
  return a === 'center' || a === 'right' || a === 'justify' ? a : 'left';
};

function block(
  node: EditorNode,
  values: Values,
  key: number,
  s: ReturnType<typeof styles>,
  list?: { ordered: boolean; index: number },
): ReactElement | null {
  const kids = node.content ?? [];
  switch (node.type) {
    case 'paragraph':
      return (
        <Text key={key} style={{ ...s.p, textAlign: alignOf(node) }}>
          {kids.map((k, i) => inline(k, values, i))}
          {kids.length === 0 ? ' ' : null}
        </Text>
      );
    case 'heading': {
      const level = Number(node.attrs?.level ?? 2);
      return (
        <Text
          key={key}
          style={{
            ...s.p,
            fontWeight: 700,
            fontSize: level === 1 ? 18 : level === 2 ? 14 : 12,
            textAlign: alignOf(node),
          }}
        >
          {kids.map((k, i) => inline(k, values, i))}
        </Text>
      );
    }
    case 'bulletList':
    case 'orderedList':
      return (
        <View key={key} style={s.list}>
          {kids.map((k, i) =>
            block(k, values, i, s, {
              ordered: node.type === 'orderedList',
              index: i + 1,
            }),
          )}
        </View>
      );
    case 'listItem':
      return (
        <View key={key} style={s.li} wrap={false}>
          <Text style={s.bullet}>{list?.ordered ? `${list.index}.` : '•'}</Text>
          <View style={{ flex: 1 }}>
            {kids.map((k, i) => block(k, values, i, s))}
          </View>
        </View>
      );
    case 'table':
      return (
        <View key={key} style={s.table}>
          {kids.map((k, i) => block(k, values, i, s))}
        </View>
      );
    case 'tableRow':
      return (
        <View key={key} style={s.row} wrap={false}>
          {kids.map((k, i) => block(k, values, i, s))}
        </View>
      );
    case 'tableCell':
    case 'tableHeader':
      return (
        <View
          key={key}
          style={{
            ...s.cell,
            ...(node.type === 'tableHeader'
              ? { backgroundColor: '#f1f1f1' }
              : {}),
          }}
        >
          {kids.map((k, i) =>
            node.type === 'tableHeader' && k.type === 'paragraph'
              ? block(
                  {
                    ...k,
                    content: k.content?.map((t) => ({
                      ...t,
                      marks: [{ type: 'bold' as const }],
                    })),
                  },
                  values,
                  i,
                  s,
                )
              : block(k, values, i, s),
          )}
        </View>
      );
    case 'horizontalRule':
      return <View key={key} style={s.rule} />;
    case 'signatureBox':
      return (
        <View key={key} style={s.sign} wrap={false}>
          <View style={s.signLine} />
          <Text style={{ fontWeight: 700 }}>
            {fill(String(node.attrs?.name ?? ''), values)}
          </Text>
          <Text>{fill(String(node.attrs?.title ?? ''), values)}</Text>
        </View>
      );
    default:
      return null;
  }
}

const styles = (font: string[]) =>
  StyleSheet.create({
    page: { fontFamily: font, fontSize: 11, lineHeight: 1.5 },
    p: { marginBottom: 8 },
    list: { marginBottom: 8 },
    li: { flexDirection: 'row', marginBottom: 3 },
    bullet: { width: 18 },
    table: { borderWidth: 0.7, borderColor: '#999', marginBottom: 10 },
    row: { flexDirection: 'row', borderBottomWidth: 0.7, borderColor: '#999' },
    cell: {
      flex: 1,
      padding: 5,
      borderRightWidth: 0.7,
      borderColor: '#999',
    },
    rule: { borderBottomWidth: 0.7, borderColor: '#999', marginVertical: 8 },
    sign: { marginTop: 18, width: 200 },
    signLine: {
      height: 40,
      borderBottomWidth: 0.7,
      borderColor: '#333',
      marginBottom: 4,
    },
  });

function make(
  key: string,
  label: string,
  orientation: 'PORTRAIT' | 'LANDSCAPE',
): Layout {
  return {
    key,
    label,
    orientation,
    fillsItself: true,
    contentSchema: z.object({ doc: editorDocString }),
    defaultContent: { doc: STARTER_DOC },
    defaultFields: [
      {
        key: 'recipientName',
        label: 'Recipient name',
        type: 'text',
        required: true,
      },
    ],
    render({ content, margins, values }: BodyProps) {
      const font = registerFonts();
      const s = styles(font);
      const doc = JSON.parse(content.doc ?? STARTER_DOC) as EditorNode;
      return (
        <Document>
          <Page
            size="A4"
            orientation={orientation === 'LANDSCAPE' ? 'landscape' : 'portrait'}
            style={{
              ...s.page,
              paddingTop: margins.top,
              paddingBottom: margins.bottom,
              paddingLeft: margins.left,
              paddingRight: margins.right,
            }}
            wrap
          >
            {(doc.content ?? []).map((n, i) => block(n, values, i, s))}
          </Page>
        </Document>
      );
    },
  };
}

export const editorLayout = make(
  'editor',
  'Visual editor (portrait)',
  'PORTRAIT',
);
export const editorLandscapeLayout = make(
  'editor-landscape',
  'Visual editor (landscape)',
  'LANDSCAPE',
);

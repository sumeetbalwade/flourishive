import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { z } from 'zod';
import { registerFonts } from './fonts.js';
import type { Layout } from './registry.js';

const text = (max: number) => z.string().max(max);

export const letterLayout: Layout = {
  key: 'letter',
  label: 'Standard letter',
  orientation: 'PORTRAIT',
  contentSchema: z.object({
    subject: text(200),
    salutation: text(200),
    body: text(6000),
    closing: text(200),
    signatoryName: text(100),
    signatoryTitle: text(100),
  }),
  defaultContent: {
    subject: '',
    salutation: 'Dear {{recipientName}},',
    body: '',
    closing: 'Yours sincerely,',
    signatoryName: '',
    signatoryTitle: '',
  },
  defaultFields: [
    {
      key: 'recipientName',
      label: 'Recipient name',
      type: 'text',
      required: true,
    },
  ],
  render({ content, margins }) {
    const font = registerFonts();
    const s = StyleSheet.create({
      page: {
        fontFamily: font,
        fontSize: 11,
        lineHeight: 1.5,
        paddingTop: margins.top,
        paddingBottom: margins.bottom,
        paddingLeft: margins.left,
        paddingRight: margins.right,
      },
      meta: { marginBottom: 14 },
      subject: { fontSize: 12, fontWeight: 700, marginBottom: 12 },
      p: { marginBottom: 9, textAlign: 'justify' },
      sign: { marginTop: 18 },
      gap: { height: 44 },
    });
    const paragraphs = (content.body ?? '').split(/\n{2,}/).filter(Boolean);
    return (
      <Document>
        <Page size="A4" style={s.page} wrap>
          <View style={s.meta}>
            <Text>Ref: {content.reference}</Text>
            <Text>Date: {content.issueDate}</Text>
          </View>
          {content.subject ? (
            <Text style={s.subject}>{content.subject}</Text>
          ) : null}
          {content.salutation ? (
            <Text style={s.p}>{content.salutation}</Text>
          ) : null}
          {paragraphs.map((p, i) => (
            <Text key={i} style={s.p}>
              {p}
            </Text>
          ))}
          <View style={s.sign} wrap={false}>
            <Text>{content.closing}</Text>
            <View style={s.gap} />
            <Text style={{ fontWeight: 700 }}>{content.signatoryName}</Text>
            <Text>{content.signatoryTitle}</Text>
          </View>
        </Page>
      </Document>
    );
  },
};

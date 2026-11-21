import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { z } from 'zod';
import { registerFonts } from './fonts.js';
import type { Layout } from './registry.js';

export const certificateLayout: Layout = {
  key: 'certificate',
  label: 'Certificate (landscape)',
  orientation: 'LANDSCAPE',
  contentSchema: z.object({
    heading: z.string().max(100),
    body: z.string().max(1500),
    signatoryName: z.string().max(100),
    signatoryTitle: z.string().max(100),
  }),
  defaultContent: {
    heading: 'Certificate of Internship',
    body: 'This is to certify that {{recipientName}} completed an internship with us from {{startDate}} to {{endDate}}.',
    signatoryName: '',
    signatoryTitle: '',
  },
  defaultFields: [
    {
      key: 'recipientName',
      label: 'Intern name',
      type: 'text',
      required: true,
    },
    { key: 'startDate', label: 'Start date', type: 'date', required: true },
    { key: 'endDate', label: 'End date', type: 'date', required: true },
  ],
  render({ content, margins }) {
    const font = registerFonts();
    const s = StyleSheet.create({
      page: {
        fontFamily: font,
        paddingTop: margins.top,
        paddingBottom: margins.bottom,
        paddingLeft: margins.left,
        paddingRight: margins.right,
        alignItems: 'center',
      },
      heading: {
        fontSize: 28,
        fontWeight: 700,
        marginBottom: 28,
        textAlign: 'center',
      },
      body: {
        fontSize: 14,
        lineHeight: 1.7,
        textAlign: 'center',
        maxWidth: 600,
      },
      sign: { marginTop: 50, alignItems: 'center' },
    });
    return (
      <Document>
        <Page size="A4" orientation="landscape" style={s.page}>
          <Text style={s.heading}>{content.heading}</Text>
          <Text style={s.body}>{content.body}</Text>
          <View style={s.sign}>
            <Text style={{ fontWeight: 700 }}>{content.signatoryName}</Text>
            <Text>{content.signatoryTitle}</Text>
            <Text style={{ fontSize: 10, marginTop: 6 }}>
              {content.reference} · {content.issueDate}
            </Text>
          </View>
        </Page>
      </Document>
    );
  },
};

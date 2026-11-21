import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';
import { registerFonts } from '../documents/layouts/fonts.js';

export interface Evidence {
  reference: string;
  letterType: string;
  documentSha256: string;
  partyName: string;
  partyEmail: string;
  method: string;
  acceptedAt: Date;
  ip: string;
  userAgent: string;
  requestId: string;
  statement: string;
}

const ist = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'long',
    timeStyle: 'medium',
  }).format(d) + ' IST';

/** The page added at the end of an accepted document: who accepted, when, how, and against which file. */
export async function renderAcceptancePage(e: Evidence): Promise<Buffer> {
  const font = registerFonts();
  const s = StyleSheet.create({
    page: { fontFamily: font, fontSize: 10.5, padding: 56, lineHeight: 1.5 },
    h1: { fontSize: 18, marginBottom: 4 },
    sub: { color: '#555', marginBottom: 20 },
    row: {
      flexDirection: 'row',
      borderBottom: '0.5pt solid #ccc',
      paddingVertical: 6,
    },
    k: { width: 130, color: '#555' },
    v: { flex: 1 },
    note: { marginTop: 22, color: '#444', fontSize: 9.5 },
  });
  const rows: [string, string][] = [
    ['Document reference', e.reference],
    ['Accepted by', `${e.partyName} <${e.partyEmail}>`],
    ['Method', e.method],
    ['Time', `${ist(e.acceptedAt)} (${e.acceptedAt.toISOString()})`],
    ['IP address', e.ip],
    ['Device', e.userAgent],
    ['Document fingerprint (SHA-256)', e.documentSha256],
    ['Record id', e.requestId],
  ];
  return renderToBuffer(
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Acceptance record</Text>
        <Text style={s.sub}>{e.statement}</Text>
        {rows.map(([k, v]) => (
          <View key={k} style={s.row} wrap={false}>
            <Text style={s.k}>{k}</Text>
            <Text style={s.v}>{v}</Text>
          </View>
        ))}
        <Text style={s.note}>
          This page was added when the document was accepted, and the whole file
          was then sealed by Flourishive. If any page is changed afterwards, the
          seal reports that the document was modified. The fingerprint above
          identifies the document as it was shown for acceptance.
        </Text>
      </Page>
    </Document>,
  );
}

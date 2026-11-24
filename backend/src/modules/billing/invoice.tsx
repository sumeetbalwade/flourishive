import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { registerFonts } from '../documents/layouts/fonts.js';

export interface Party {
  name: string;
  gstin: string | null;
  address: string;
  stateCode: string;
}

export interface InvoiceData {
  number: string;
  issuedAt: Date;
  description: string;
  period: string | null;
  sacCode: string;
  gstRate: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  seller: Party;
  buyer: Party;
}

const rupees = (paise: number) =>
  `Rs. ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The tax invoice, drawn with the same PDF engine and fonts as letters. */
export function invoiceDocument(d: InvoiceData) {
  const font = registerFonts();
  const s = StyleSheet.create({
    page: { fontFamily: font, fontSize: 10, padding: 42, lineHeight: 1.4 },
    h1: { fontSize: 18, fontWeight: 700, marginBottom: 2 },
    muted: { color: '#555' },
    row: { flexDirection: 'row', justifyContent: 'space-between' },
    block: { marginTop: 16 },
    box: { width: '48%' },
    label: {
      fontSize: 8,
      color: '#777',
      textTransform: 'uppercase',
      marginBottom: 2,
    },
    th: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderColor: '#999',
      paddingBottom: 4,
      marginTop: 18,
      fontWeight: 700,
    },
    td: { flexDirection: 'row', paddingVertical: 6 },
    c1: { width: '52%' },
    c2: { width: '16%' },
    c3: { width: '32%', textAlign: 'right' },
    sum: { marginTop: 10, marginLeft: 'auto', width: '55%' },
    sumRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 2,
    },
    total: {
      borderTopWidth: 1,
      borderColor: '#999',
      marginTop: 4,
      paddingTop: 4,
      fontWeight: 700,
      fontSize: 12,
    },
    foot: { marginTop: 28, fontSize: 8, color: '#777' },
  });
  const Party_ = ({ label, p }: { label: string; p: Party }) => (
    <View style={s.box}>
      <Text style={s.label}>{label}</Text>
      <Text style={{ fontWeight: 700 }}>{p.name}</Text>
      <Text>{p.address}</Text>
      {p.gstin ? (
        <Text>GSTIN: {p.gstin}</Text>
      ) : (
        <Text style={s.muted}>GSTIN: not provided</Text>
      )}
      <Text>State code: {p.stateCode}</Text>
    </View>
  );
  const intra = d.igst === 0;
  return (
    <Document title={`Invoice ${d.number}`}>
      <Page size="A4" style={s.page}>
        <View style={s.row}>
          <View>
            <Text style={s.h1}>Tax invoice</Text>
            <Text style={s.muted}>{d.number}</Text>
          </View>
          <View>
            <Text style={s.label}>Date</Text>
            <Text>{d.issuedAt.toISOString().slice(0, 10)}</Text>
          </View>
        </View>
        <View style={[s.row, s.block]}>
          <Party_ label="From" p={d.seller} />
          <Party_ label="Billed to" p={d.buyer} />
        </View>
        <View style={s.th}>
          <Text style={s.c1}>Description</Text>
          <Text style={s.c2}>SAC</Text>
          <Text style={s.c3}>Taxable value</Text>
        </View>
        <View style={s.td}>
          <View style={s.c1}>
            <Text>{d.description}</Text>
            {d.period ? <Text style={s.muted}>{d.period}</Text> : null}
          </View>
          <Text style={s.c2}>{d.sacCode}</Text>
          <Text style={s.c3}>{rupees(d.taxableValue)}</Text>
        </View>
        <View style={s.sum}>
          <View style={s.sumRow}>
            <Text>Taxable value</Text>
            <Text>{rupees(d.taxableValue)}</Text>
          </View>
          {intra ? (
            <>
              <View style={s.sumRow}>
                <Text>CGST ({d.gstRate / 2}%)</Text>
                <Text>{rupees(d.cgst)}</Text>
              </View>
              <View style={s.sumRow}>
                <Text>SGST ({d.gstRate / 2}%)</Text>
                <Text>{rupees(d.sgst)}</Text>
              </View>
            </>
          ) : (
            <View style={s.sumRow}>
              <Text>IGST ({d.gstRate}%)</Text>
              <Text>{rupees(d.igst)}</Text>
            </View>
          )}
          <View style={[s.sumRow, s.total]}>
            <Text>Total</Text>
            <Text>{rupees(d.total)}</Text>
          </View>
        </View>
        <Text style={s.foot}>
          This is a computer generated invoice and needs no signature. The
          amount shown is inclusive of GST and has been received in full.
        </Text>
      </Page>
    </Document>
  );
}

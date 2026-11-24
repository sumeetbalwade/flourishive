/** GST on a tax-inclusive amount, in paise. Pure, so it is easy to test. */
export function splitGst(
  totalPaise: number,
  ratePercent: number,
  sellerState: string,
  buyerState: string,
): { taxable: number; cgst: number; sgst: number; igst: number } {
  const taxable = Math.round((totalPaise * 100) / (100 + ratePercent));
  const tax = totalPaise - taxable;
  if (sellerState === buyerState) {
    const cgst = Math.floor(tax / 2);
    return { taxable, cgst, sgst: tax - cgst, igst: 0 };
  }
  return { taxable, cgst: 0, sgst: 0, igst: tax };
}

/** Indian financial year of a date: April to March, written 2026-27. */
export function financialYear(d: Date): string {
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

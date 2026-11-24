import { describe, expect, it } from 'vitest';
import { financialYear, splitGst } from './gst.js';

describe('splitGst', () => {
  it('splits an inclusive amount into taxable value and CGST plus SGST in the same state', () => {
    const r = splitGst(118000, 18, '27', '27');
    expect(r).toEqual({ taxable: 100000, cgst: 9000, sgst: 9000, igst: 0 });
  });
  it('charges IGST across states', () => {
    const r = splitGst(118000, 18, '27', '29');
    expect(r).toEqual({ taxable: 100000, cgst: 0, sgst: 0, igst: 18000 });
  });
  it('always adds up to the total, even with odd paise', () => {
    const r = splitGst(99901, 18, '27', '27');
    expect(r.taxable + r.cgst + r.sgst + r.igst).toBe(99901);
  });
});

describe('financialYear', () => {
  it('runs April to March', () => {
    expect(financialYear(new Date('2026-03-31T00:00:00Z'))).toBe('2025-26');
    expect(financialYear(new Date('2026-04-01T00:00:00Z'))).toBe('2026-27');
    expect(financialYear(new Date('2026-11-24T00:00:00Z'))).toBe('2026-27');
  });
});

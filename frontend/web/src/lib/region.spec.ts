import { describe, expect, it } from 'vitest';
import { fiscalYear, fmtDate, fmtDateTime, fmtMoney, fmtNumber, setRegion } from '@flourishive/ui';

describe('region formatting', () => {
  it('defaults to the Indian style', () => {
    setRegion({});
    expect(fmtDate('2026-04-01T00:00:00Z')).toBe('01 Apr 2026');
    expect(fmtNumber(1234567)).toBe('12,34,567');
  });
  it('follows the company’s date format and grouping', () => {
    setRegion({ 'region.dateFormat': 'DD/MM/YYYY', 'region.numberGrouping': 'international' });
    expect(fmtDate('2026-04-01T00:00:00Z')).toBe('01/04/2026');
    expect(fmtNumber(1234567)).toBe('1,234,567');
    setRegion({ 'region.dateFormat': 'YYYY-MM-DD' });
    expect(fmtDate('2026-04-01T00:00:00Z')).toBe('2026-04-01');
  });
  it('shows moments in the company’s zone', () => {
    setRegion({ 'region.timeZone': 'Asia/Kolkata' });
    expect(fmtDateTime('2026-11-24T20:00:00Z')).toBe('25 Nov 2026, 01:30');
  });
  it('formats money in the chosen currency', () => {
    setRegion({ 'region.currency': 'INR' });
    expect(fmtMoney(1500)).toContain('1,500');
    expect(fmtMoney(1500)).toContain('₹');
  });
  it('names the financial year from the start month', () => {
    setRegion({ 'region.fyStartMonth': 4 });
    expect(fiscalYear('2026-02-10')).toBe('FY 2025-26');
    expect(fiscalYear('2026-04-10')).toBe('FY 2026-27');
    setRegion({});
  });
});

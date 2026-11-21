import { fill, resolveValues, placeholdersIn } from './fill.js';
import { formatReference } from './numbering.js';

describe('formatReference', () => {
  it('fills year and padded sequence', () => {
    expect(formatReference('FS/INT/{YYYY}/{SEQ:4}', 2026, 12)).toBe(
      'FS/INT/2026/0012',
    );
    expect(formatReference('C-{YY}-{SEQ:3}', 2026, 7)).toBe('C-26-007');
  });
  it('does not truncate a number longer than the padding', () => {
    expect(formatReference('{SEQ:2}', 2026, 1234)).toBe('1234');
  });
});

describe('fill and resolveValues', () => {
  it('finds and replaces placeholders, blank when missing', () => {
    expect(placeholdersIn('Hi {{ a }} and {{b}}')).toEqual(['a', 'b']);
    expect(fill('Hi {{a}} {{zz}}!', { a: 'Asha' })).toBe('Hi Asha !');
  });
  it('requires required fields and formats dates', () => {
    const fields = [
      { key: 'n', label: 'Name', type: 'text' as const, required: true },
      { key: 'd', label: 'Date', type: 'date' as const, required: false },
    ];
    expect(resolveValues(fields, {}).errors).toEqual(['Name is required']);
    expect(resolveValues(fields, { n: 'A', d: '01/12/2026' }).values.d).toBe(
      '1 December 2026',
    );
    expect(resolveValues(fields, { n: 'A', d: 'soon' }).errors).toHaveLength(1);
  });
});

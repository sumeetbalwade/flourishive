import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv.ts';

describe('parseCsv', () => {
  it('reads a header and rows, honouring quotes', () => {
    expect(parseCsv('recipientName,role\nAsha Rao,"Design, UX"\n\nRavi Iyer,Dev\n')).toEqual([
      { recipientName: 'Asha Rao', role: 'Design, UX' },
      { recipientName: 'Ravi Iyer', role: 'Dev' },
    ]);
  });
  it('gives nothing for a header alone', () => {
    expect(parseCsv('recipientName')).toEqual([]);
  });
});

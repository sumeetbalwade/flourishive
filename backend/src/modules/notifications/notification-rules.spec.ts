import { quietDelayMs } from './notification-rules.js';

const q = { enabled: true, start: '22:00', end: '07:00' };

describe('quietDelayMs', () => {
  it('sends straight away in the daytime', () => {
    // 05:30 UTC is 11:00 in India.
    expect(
      quietDelayMs(new Date('2026-11-24T05:30:00Z'), 'Asia/Kolkata', q),
    ).toBe(0);
  });
  it('holds late-night mail until the window ends, across midnight', () => {
    // 17:30 UTC is 23:00 in India: 8 hours until 07:00.
    expect(
      quietDelayMs(new Date('2026-11-24T17:30:00Z'), 'Asia/Kolkata', q),
    ).toBe(8 * 3_600_000);
    // 22:30 UTC is 04:00 next day in India: 3 hours.
    expect(
      quietDelayMs(new Date('2026-11-24T22:30:00Z'), 'Asia/Kolkata', q),
    ).toBe(3 * 3_600_000);
  });
  it('does nothing when quiet hours are off', () => {
    expect(
      quietDelayMs(new Date('2026-11-24T17:30:00Z'), 'Asia/Kolkata', {
        ...q,
        enabled: false,
      }),
    ).toBe(0);
  });
});

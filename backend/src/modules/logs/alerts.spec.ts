import { localClock } from './alerts.service.js';

describe('localClock', () => {
  it('reads the hour in the subscriber’s own time zone', () => {
    // 02:30 UTC is 08:00 in India (UTC+5:30).
    const c = localClock(new Date('2026-11-24T02:30:00Z'), 'Asia/Kolkata');
    expect(c).toEqual({ hour: 8, day: '2026-11-24' });
  });

  it('rolls the day over with the zone', () => {
    const c = localClock(new Date('2026-11-24T20:00:00Z'), 'Asia/Kolkata');
    expect(c.day).toBe('2026-11-25');
  });

  it('falls back to India for a zone it does not know', () => {
    expect(localClock(new Date('2026-11-24T02:30:00Z'), 'Mars/Base').hour).toBe(
      8,
    );
  });
});

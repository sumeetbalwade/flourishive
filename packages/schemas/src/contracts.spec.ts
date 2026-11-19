import { describe, expect, it } from 'vitest';
import {
  createPersonBody,
  loginResponse,
  parseDate,
  createTenantBody,
  orgBodies,
} from './index.js';

describe('shared contracts', () => {
  it('parses Indian and ISO dates and rejects impossible ones', () => {
    expect(parseDate('01/04/2025')?.toISOString()).toBe('2025-04-01T00:00:00.000Z');
    expect(parseDate('2026-06-01')?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(parseDate('2026-02-30')).toBeNull();
    expect(parseDate('13/13/2026')).toBeNull();
  });

  it('validates a person with an intern engagement', () => {
    const ok = createPersonBody.safeParse({
      person: { firstName: 'Asha', lastName: 'Patil', workEmail: 'ASHA@x.test' },
      engagement: {
        entityId: crypto.randomUUID(),
        type: 'INTERN',
        employeeCode: 'I1',
        startDate: '2026-01-05',
      },
    });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.person?.workEmail).toBe('asha@x.test'); // lower-cased
    expect(createPersonBody.safeParse({ engagement: { type: 'BOSS' } }).success).toBe(false);
  });

  it('tells the three login outcomes apart', () => {
    expect(loginResponse.parse({ status: 'ok', accessToken: 'a', expiresIn: 900 }).status).toBe(
      'ok',
    );
    expect(loginResponse.parse({ status: 'mfa_required', mfaToken: 'm' }).status).toBe(
      'mfa_required',
    );
    expect(loginResponse.safeParse({ status: 'mfa_required' }).success).toBe(false);
  });

  it('keeps company codes and catalogue names in shape', () => {
    const base = { name: 'N', companyName: 'C', legalName: 'L', adminEmail: 'a@b.test' };
    expect(createTenantBody.safeParse({ ...base, slug: 'acme-co' }).success).toBe(true);
    expect(createTenantBody.safeParse({ ...base, slug: '_hidden' }).success).toBe(false);
    expect(orgBodies.locations.safeParse({ name: 'Pune', state: 'Maharashtra' }).success).toBe(
      true,
    );
    expect(orgBodies.departments.safeParse({ name: '  ' }).success).toBe(false);
  });
});

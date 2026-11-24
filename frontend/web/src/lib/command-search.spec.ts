import { describe, expect, it } from 'vitest';
import { commandMatches as matches } from '@flourishive/ui';

const setting = {
  label: 'Passwords expire after (days)',
  hint: 'Setting · Security',
  keywords: 'security.passwordExpiryDays 0 means never',
};

describe('command search', () => {
  it('finds a setting by its words, loosely', () => {
    expect(matches(setting, 'password expiry')).toBe(true);
    expect(matches(setting, 'expire')).toBe(true);
    expect(matches(setting, 'security')).toBe(true);
  });
  it('needs every word', () => {
    expect(matches(setting, 'password colour')).toBe(false);
  });
});

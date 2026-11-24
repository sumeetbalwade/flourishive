import { PasswordPolicyService } from './password-policy.service.js';

describe('PasswordPolicyService.hasMix', () => {
  it('needs a letter, a digit and a symbol', () => {
    expect(PasswordPolicyService.hasMix('correct-horse-9')).toBe(true);
    expect(PasswordPolicyService.hasMix('correcthorsebattery')).toBe(false);
    expect(PasswordPolicyService.hasMix('12345678901!')).toBe(false);
    expect(PasswordPolicyService.hasMix('Letters123456')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { canActOn } from './can-act-on.js';

describe('the subset rule', () => {
  it('allows acting on someone with fewer powers', () => {
    expect(
      canActOn(
        { 'people.read': ['*'], 'people.write': ['*'] },
        { 'people.read': ['*'] },
      ),
    ).toBe(true);
  });

  it('allows acting on someone with exactly the same powers', () => {
    const same = { 'people.read': ['*'], 'users.manage': ['*'] };
    expect(canActOn(same, { ...same })).toBe(true);
  });

  it('refuses someone with a power the actor lacks', () => {
    expect(
      canActOn({ 'people.read': ['*'] }, { 'people.read': ['*'], 'roles.assign': ['*'] }),
    ).toBe(false);
  });

  it('a power held for one company does not cover everywhere', () => {
    expect(canActOn({ 'people.write': ['e1'] }, { 'people.write': ['*'] })).toBe(false);
  });

  it('a power held for one company covers that company only', () => {
    expect(canActOn({ 'people.write': ['e1', 'e2'] }, { 'people.write': ['e1'] })).toBe(true);
    expect(canActOn({ 'people.write': ['e1'] }, { 'people.write': ['e1', 'e2'] })).toBe(false);
  });

  it('everywhere covers any single company', () => {
    expect(canActOn({ 'people.write': ['*'] }, { 'people.write': ['e9'] })).toBe(true);
  });

  it('someone with no powers can be acted on by anyone', () => {
    expect(canActOn({}, {})).toBe(true);
    expect(canActOn({ 'people.read': ['*'] }, {})).toBe(true);
  });

  it('a target holding a custom role is judged by the powers it grants', () => {
    // The custom role adds documents.sign, which the actor lacks.
    expect(
      canActOn(
        { 'people.read': ['*'], 'documents.read': ['*'] },
        { 'people.read': ['*'], 'documents.sign': ['*'] },
      ),
    ).toBe(false);
  });
});

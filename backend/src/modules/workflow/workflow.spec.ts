import { definitionSchema, LETTER_FLOW } from './definition.js';

describe('flow definitions', () => {
  it('accepts the standard letters flow', () => {
    expect(definitionSchema.safeParse(LETTER_FLOW).success).toBe(true);
  });
  it('rejects unknown states, final-state exits and unowned person actions', () => {
    const bad = (patch: object) =>
      definitionSchema.safeParse({ ...LETTER_FLOW, ...patch }).success;
    expect(bad({ initial: 'nope' })).toBe(false);
    expect(
      bad({
        transitions: [
          {
            action: 'x',
            label: 'X',
            from: ['issued'],
            to: 'draft',
            permission: 'p',
            system: false,
            commentRequired: false,
          },
        ],
      }),
    ).toBe(false);
    expect(
      bad({
        transitions: [
          {
            action: 'x',
            label: 'X',
            from: ['draft'],
            to: 'issued',
            system: false,
            commentRequired: false,
          },
        ],
      }),
    ).toBe(false);
    expect(
      bad({
        transitions: [
          {
            action: 'x',
            label: 'X',
            from: ['draft'],
            to: 'ghost',
            permission: 'p',
            system: false,
            commentRequired: false,
          },
        ],
      }),
    ).toBe(false);
  });
  it('never lets a person take a signing step', () => {
    for (const t of LETTER_FLOW.transitions)
      if (['start_signing', 'issue', 'signing_failed'].includes(t.action))
        expect(t.system).toBe(true);
  });
});

/**
 * Events sent through NotificationsService. The wording of the credential emails (invite, password reset)
 * lives in `events.ts` so people can reword it; `general.notice` is a plain message the caller writes.
 */
export interface RenderedEmail {
  subject: string;
  text: string;
}

export const TEMPLATES = {
  /** A plain message with no credentials in it. Safe to queue and to keep on record. */
  'general.notice': (v: { subject: string; text: string }): RenderedEmail => ({
    subject: v.subject,
    text: v.text,
  }),
} satisfies Record<string, (vars: never) => RenderedEmail>;

/** Reworded in the template editor: the caller passes only the values. */
export interface EditableVars {
  'auth.invite': { link: string };
  'auth.password_reset': { link: string };
}
export const EDITABLE_EXPIRES: Record<keyof EditableVars, string> = {
  'auth.invite': '7 days',
  'auth.password_reset': 'one hour',
};

export type NotificationEvent = keyof typeof TEMPLATES | keyof EditableVars;
export type TemplateVars<E extends NotificationEvent> =
  E extends keyof EditableVars
    ? EditableVars[E]
    : E extends keyof typeof TEMPLATES
      ? Omit<Parameters<(typeof TEMPLATES)[E]>[0], 'app'>
      : never;

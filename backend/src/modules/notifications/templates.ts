/** One template per event. Add events here as modules need them (letters, reminders, ...). */
export interface RenderedEmail {
  subject: string;
  text: string;
}

export const TEMPLATES = {
  'auth.password_reset': (v: { link: string }): RenderedEmail => ({
    subject: 'Reset your Flourishive password',
    text: `Use this link within one hour to choose a new password:\n\n${v.link}\n\nIf you did not ask for this, you can ignore this email.`,
  }),
  'auth.invite': (v: { link: string }): RenderedEmail => ({
    subject: 'You have been invited to Flourishive',
    text: `Choose a password to activate your account (link valid for 7 days):\n\n${v.link}`,
  }),
  /** A plain message with no credentials in it. Safe to queue and to keep on record. */
  'general.notice': (v: { subject: string; text: string }): RenderedEmail => ({
    subject: v.subject,
    text: v.text,
  }),
} satisfies Record<string, (vars: never) => RenderedEmail>;

export type NotificationEvent = keyof typeof TEMPLATES;
export type TemplateVars<E extends NotificationEvent> = Parameters<
  (typeof TEMPLATES)[E]
>[0];

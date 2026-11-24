/**
 * The email events a person can reword (D-59). Each one lists the placeholders its text may use, with
 * sample values for previews, and the built-in subject and body. Add an event here, then send it with
 * EmailTemplatesService.render(); nothing else needs to change.
 *
 * Body format ("markdown-lite"): paragraphs separated by a blank line, **bold**, [text](https://link or {{var}}),
 * and a button on its own line: [[Button text|{{link}}]].
 */
export interface EventVariable {
  name: string;
  description: string;
  sample: string;
}

export interface EmailEventDef {
  key: string;
  label: string;
  description: string;
  /** Who may reword it: companies (and the platform), or the platform only. */
  audience: 'tenant' | 'platform';
  /** Whether a company may override the platform's wording unless the platform locks it. */
  tenantEditable: boolean;
  variables: EventVariable[];
  /** Placeholders the text must keep, so a reworded mail never drops the code or the link. */
  required: string[];
  /** The mail holds a code or private link: never keep its text on record. */
  sensitive: boolean;
  subject: string;
  body: string;
}

const code: EventVariable = {
  name: 'code',
  description: 'The one-time code',
  sample: '482 913',
};
const minutes: EventVariable = {
  name: 'minutes',
  description: 'How many minutes the code works for',
  sample: '10',
};
const link = (what: string): EventVariable => ({
  name: 'link',
  description: what,
  sample: 'https://app.example.com/#/open?token=abc123',
});
const expires = (sample: string): EventVariable => ({
  name: 'expires',
  description: 'How long or until when the link works',
  sample,
});
const reference: EventVariable = {
  name: 'reference',
  description: 'The document reference',
  sample: 'OFR-2026-0042',
};
const name: EventVariable = {
  name: 'name',
  description: 'The recipient’s name',
  sample: 'Asha Rao',
};
const app: EventVariable = {
  name: 'app',
  description: 'The product name',
  sample: 'Flourishive',
};

const company: EventVariable = {
  name: 'company',
  description: 'The company name',
  sample: 'Acme Pvt Ltd',
};
const planLink: EventVariable = {
  name: 'link',
  description: 'Where to see the plan and pay',
  sample: 'https://acme.example.com/#/app/plan',
};

export const EMAIL_EVENTS: EmailEventDef[] = [
  {
    key: 'billing.invoice',
    label: 'Invoice for a payment',
    description: 'Sent to the billing contact after each successful payment.',
    audience: 'platform',
    tenantEditable: false,
    variables: [
      app,
      company,
      {
        name: 'number',
        description: 'Invoice number',
        sample: 'FH/2026-27/00001',
      },
      { name: 'amount', description: 'Amount paid', sample: 'Rs. 999.00' },
      planLink,
    ],
    required: ['number'],
    sensitive: false,
    subject: 'Your {{app}} invoice {{number}}',
    body: 'Thank you, {{company}}. We received {{amount}}.\n\nYour tax invoice **{{number}}** is ready to download:\n\n[[Open billing|{{link}}]]',
  },
  {
    key: 'billing.payment_failed',
    label: 'Payment failed',
    description:
      'Reminder while a payment is overdue, before the account turns read-only.',
    audience: 'platform',
    tenantEditable: false,
    variables: [
      app,
      company,
      {
        name: 'date',
        description: 'When the account turns read-only',
        sample: 'Monday 1 December 2026',
      },
      planLink,
    ],
    required: ['date'],
    sensitive: false,
    subject: 'Action needed: your {{app}} payment did not go through',
    body: 'Hello {{company}},\n\nWe could not collect your subscription payment. Please update your payment method.\n\nIf it is not fixed by **{{date}}**, your account becomes read-only: people can look at records but not change anything.\n\n[[Fix payment|{{link}}]]',
  },
  {
    key: 'billing.read_only',
    label: 'Account is read-only',
    description: 'Sent when an overdue payment turns the account read-only.',
    audience: 'platform',
    tenantEditable: false,
    variables: [app, company, planLink],
    required: [],
    sensitive: false,
    subject: 'Your {{app}} account is now read-only',
    body: 'Hello {{company}},\n\nBecause the subscription payment is still overdue, your account is now read-only. Nothing is lost. Pay to switch editing back on straight away.\n\n[[Pay now|{{link}}]]',
  },
  {
    key: 'billing.suspended',
    label: 'Account suspended',
    description: 'Sent when a long overdue payment suspends the account.',
    audience: 'platform',
    tenantEditable: false,
    variables: [app, company, planLink],
    required: [],
    sensitive: false,
    subject: 'Your {{app}} account is suspended',
    body: 'Hello {{company}},\n\nYour account is suspended because the subscription payment stayed overdue. Your data is kept safely. Contact us to restore access.\n\n[[Contact billing|{{link}}]]',
  },
  {
    key: 'auth.invite',
    label: 'Invitation to join',
    description: 'Sent when someone is invited to sign in for the first time.',
    audience: 'tenant',
    tenantEditable: true,
    variables: [
      app,
      link('The private link to choose a password'),
      expires('7 days'),
    ],
    required: ['link'],
    sensitive: true,
    subject: 'You have been invited to {{app}}',
    body: 'You have been invited to {{app}}.\n\nChoose a password to activate your account (the link works for {{expires}}):\n\n[[Choose a password|{{link}}]]',
  },
  {
    key: 'auth.password_reset',
    label: 'Password reset link',
    description: 'Sent when an admin or the person asks to reset a password.',
    audience: 'tenant',
    tenantEditable: true,
    variables: [
      app,
      link('The private link to choose a new password'),
      expires('one hour'),
    ],
    required: ['link'],
    sensitive: true,
    subject: 'Reset your {{app}} password',
    body: 'Use this link within {{expires}} to choose a new password:\n\n[[Choose a new password|{{link}}]]\n\nIf you did not ask for this, you can ignore this email.',
  },
  {
    key: 'auth.otp',
    label: 'Sign-in and reset code',
    description:
      'The 6-digit code for two-step sign-in, forgotten passwords and email recovery.',
    audience: 'tenant',
    tenantEditable: true,
    variables: [app, code, minutes],
    required: ['code'],
    sensitive: true,
    subject: 'Your {{app}} code: {{code}}',
    body: 'Your one-time code is **{{code}}**. It works once and expires in {{minutes}} minutes.\n\nIf you did not ask for it, ignore this email and consider changing your password.',
  },
  {
    key: 'signing.request',
    label: 'Document sent for acceptance',
    description: 'Sent to the person who has to review and accept a document.',
    audience: 'tenant',
    tenantEditable: true,
    variables: [
      app,
      name,
      reference,
      link('The private link to open the document'),
      {
        name: 'method',
        description: 'How they will accept it',
        sample: 'confirm with a code we email you',
      },
      expires('Friday 5 June 2026'),
    ],
    required: ['link'],
    sensitive: true,
    subject: 'Please review and accept: {{reference}}',
    body: 'Hello {{name}},\n\nYou have a document to review and accept: **{{reference}}**.\n\nOpen the private link, read the document and {{method}}:\n\n[[Review the document|{{link}}]]\n\nThe link works until {{expires}}. Do not forward it.',
  },
  {
    key: 'signing.otp',
    label: 'Acceptance code',
    description: 'The code a person types to accept a document.',
    audience: 'tenant',
    tenantEditable: true,
    variables: [app, code, minutes],
    required: ['code'],
    sensitive: true,
    subject: 'Your {{app}} code: {{code}}',
    body: 'Your one-time code to accept the document is **{{code}}**. It works once and expires in {{minutes}} minutes.\n\nIf you did not ask for it, ignore this email.',
  },
  {
    key: 'letter.delivery',
    label: 'Letter issued',
    description: 'Sent to a person when a letter is ready for them.',
    audience: 'tenant',
    tenantEditable: true,
    variables: [
      app,
      name,
      reference,
      link('The private link to open the letter'),
      {
        name: 'action',
        description: 'What the link lets them do',
        sample: 'see it and download it',
      },
      {
        name: 'note',
        description:
          'An extra line when the download is not open yet (may be empty)',
        sample: '',
      },
      expires('Friday 5 June 2026'),
    ],
    required: ['link'],
    sensitive: true,
    subject: 'Your letter: {{reference}}',
    body: 'Hello {{name}},\n\nYour letter (**{{reference}}**) is ready. Open the private link to {{action}}:\n\n[[Open your letter|{{link}}]]\n\n{{note}}\n\nThe link works until {{expires}}. Do not forward it.',
  },
  {
    key: 'platform.signin_code',
    label: 'Admin console sign-in code',
    description: 'The code staff type to sign in to the admin console.',
    audience: 'platform',
    tenantEditable: false,
    variables: [app, code, minutes],
    required: ['code'],
    sensitive: true,
    subject: 'Your {{app}} admin code: {{code}}',
    body: 'Your one-time sign-in code is **{{code}}**. It works once and expires in {{minutes}} minutes.\n\nIf you did not ask for it, change your password now.',
  },
  {
    key: 'platform.recovery_code',
    label: 'Admin console recovery code',
    description: 'The code staff use when they cannot use their second step.',
    audience: 'platform',
    tenantEditable: false,
    variables: [app, code, minutes],
    required: ['code'],
    sensitive: true,
    subject: 'Your {{app}} admin code: {{code}}',
    body: 'Your one-time code is **{{code}}**. It works once and expires in {{minutes}} minutes.\n\nIf you did not ask for it, change your password now.',
  },
  {
    key: 'platform.invite',
    label: 'Admin console invitation',
    description: 'Sent to a new staff member.',
    audience: 'platform',
    tenantEditable: false,
    variables: [
      app,
      link('The private link to choose a password'),
      expires('7 days'),
    ],
    required: ['link'],
    sensitive: true,
    subject: 'You have been invited to the {{app}} admin console',
    body: 'Choose a password (the link works for {{expires}}):\n\n[[Choose a password|{{link}}]]\n\nIf you did not expect this, tell another administrator.',
  },
  {
    key: 'platform.password_reset',
    label: 'Admin console password reset',
    description: 'Sent when a staff password is reset.',
    audience: 'platform',
    tenantEditable: false,
    variables: [
      app,
      link('The private link to choose a new password'),
      expires('one hour'),
    ],
    required: ['link'],
    sensitive: true,
    subject: 'Reset your {{app}} admin password',
    body: 'Choose a password (the link works for {{expires}}):\n\n[[Choose a new password|{{link}}]]\n\nIf you did not expect this, tell another administrator.',
  },
  {
    key: 'platform.account_notice',
    label: 'Change to a staff account',
    description:
      'Tells a staff member that an administrator changed their account.',
    audience: 'platform',
    tenantEditable: false,
    variables: [
      app,
      {
        name: 'change',
        description: 'What was done, as a sentence',
        sample: 'Your two-step sign-in was reset',
      },
      { name: 'actor', description: 'Who did it', sample: 'owner@example.com' },
    ],
    required: ['change'],
    sensitive: false,
    subject: 'A change to your admin account',
    body: '{{change}}.\n\nDone by {{actor}}.\n\nIf you did not expect this, tell another administrator.',
  },
  {
    key: 'company.find',
    label: 'Find my company address',
    description: 'Lists the company sign-in addresses for an email address.',
    audience: 'platform',
    tenantEditable: false,
    variables: [
      app,
      {
        name: 'addresses',
        description: 'One line per company with its sign-in address',
        sample: 'Acme: https://acme.example.com',
      },
    ],
    required: ['addresses'],
    sensitive: false,
    subject: 'Your {{app}} sign-in address',
    body: 'Sign in at your company’s address:\n\n{{addresses}}\n\nIf you did not ask for this, you can ignore this email.',
  },
  {
    key: 'sender.verify',
    label: 'Confirm a sending address',
    description:
      'The code that proves a company controls the address it sends from.',
    audience: 'platform',
    tenantEditable: false,
    variables: [
      app,
      code,
      {
        name: 'address',
        description: 'The address being confirmed',
        sample: 'hr@acme.example',
      },
    ],
    required: ['code'],
    sensitive: true,
    subject: 'Confirm this address for sending email: {{code}}',
    body: 'Your code is **{{code}}**. It works once and expires in 10 minutes.\n\nIt confirms that you control {{address}}, so the company can send email from it. If you did not ask for it, ignore this message.',
  },
];

const BY_KEY = new Map(EMAIL_EVENTS.map((e) => [e.key, e]));
export const eventDef = (key: string): EmailEventDef | undefined =>
  BY_KEY.get(key);
export type EmailEventKey = string;

/** `{{name}}` with optional spaces. Names are letters, digits and underscores. */
export const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

import type { FieldDef, LetterType } from '@flourishive/schemas';

/**
 * Starter wording for the four intern letters. This is draft wording for HR to edit; it has not
 * been reviewed by HR or legal. Every {{name}} below has a matching field.
 */
export interface StarterTemplate {
  name: string;
  letterType: LetterType;
  layoutKey: 'letter' | 'certificate';
  content: Record<string, string>;
  fields: FieldDef[];
}

const f = (
  key: string,
  label: string,
  type: FieldDef['type'] = 'text',
  required = true,
): FieldDef => ({ key, label, type, required });

const signer = { signatoryName: '', signatoryTitle: 'HR Lead' };

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    name: 'Intern offer letter (draft wording)',
    letterType: 'OFFER',
    layoutKey: 'letter',
    content: {
      subject: 'Offer of internship: {{role}}',
      salutation: 'Dear {{recipientName}},',
      body: [
        'We are pleased to offer you an internship as {{role}} with us, starting on {{startDate}} and continuing until {{endDate}}, subject to the terms below.',
        'During the internship you will work from {{location}} and report to {{reportingTo}}. You will receive a monthly stipend of Rs. {{stipend}}, paid at the end of each month after statutory deductions, if any.',
        'This is an internship and not an offer of employment. It does not guarantee a job at the end of the period. Either side may end the internship earlier by giving seven days of written notice.',
        'You agree to keep confidential all information about the company, its clients and its work that you learn during the internship, and to follow the company policies shared with you.',
        'Please confirm your acceptance of this offer by the link we send you. We look forward to working with you.',
      ].join('\n\n'),
      closing: 'Yours sincerely,',
      ...signer,
    },
    fields: [
      f('recipientName', 'Intern name'),
      f('role', 'Role or domain'),
      f('startDate', 'Start date', 'date'),
      f('endDate', 'End date', 'date'),
      f('location', 'Work location'),
      f('reportingTo', 'Reporting to'),
      f('stipend', 'Monthly stipend (Rs.)', 'amount'),
    ],
  },
  {
    name: 'Internship experience letter (draft wording)',
    letterType: 'EXPERIENCE',
    layoutKey: 'letter',
    content: {
      subject: 'Experience letter',
      salutation: 'To whom it may concern,',
      body: [
        'This is to certify that {{recipientName}} worked with us as {{role}} from {{startDate}} to {{endDate}}.',
        'During this period {{recipientName}} worked on {{work}}. We found the conduct and performance during the internship to be {{performance}}.',
        'We wish {{recipientName}} every success in future work.',
      ].join('\n\n'),
      closing: 'Yours sincerely,',
      ...signer,
    },
    fields: [
      f('recipientName', 'Intern name'),
      f('role', 'Role or domain'),
      f('startDate', 'Start date', 'date'),
      f('endDate', 'End date', 'date'),
      f('work', 'Work done', 'longtext'),
      f('performance', 'Performance (for example satisfactory, good)'),
    ],
  },
  {
    name: 'Reference letter (draft wording)',
    letterType: 'REFERENCE',
    layoutKey: 'letter',
    content: {
      subject: 'Letter of reference for {{recipientName}}',
      salutation: 'To whom it may concern,',
      body: [
        '{{recipientName}} interned with us as {{role}} from {{startDate}} to {{endDate}}, and I supervised this work.',
        '{{assessment}}',
        'I recommend {{recipientName}} and am happy to be contacted for further information.',
      ].join('\n\n'),
      closing: 'Yours sincerely,',
      ...signer,
    },
    fields: [
      f('recipientName', 'Intern name'),
      f('role', 'Role or domain'),
      f('startDate', 'Start date', 'date'),
      f('endDate', 'End date', 'date'),
      f('assessment', 'Assessment of the intern', 'longtext'),
    ],
  },
  {
    name: 'Internship certificate (draft wording)',
    letterType: 'CERTIFICATE',
    layoutKey: 'certificate',
    content: {
      heading: 'Certificate of Internship',
      body: 'This is to certify that {{recipientName}} successfully completed an internship as {{role}} with us from {{startDate}} to {{endDate}}.',
      ...signer,
    },
    fields: [
      f('recipientName', 'Intern name'),
      f('role', 'Role or domain'),
      f('startDate', 'Start date', 'date'),
      f('endDate', 'End date', 'date'),
    ],
  },
];

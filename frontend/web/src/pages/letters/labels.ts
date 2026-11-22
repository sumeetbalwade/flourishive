export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

/** How each stage of a letter's journey reads on screen. Keys match the letters flow on the server. */
export const STATE: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Waiting for approval', tone: 'warning' },
  changes_requested: { label: 'Changes requested', tone: 'danger' },
  approved: { label: 'Approved', tone: 'info' },
  signing: { label: 'Being signed', tone: 'accent' },
  issued: { label: 'Issued', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const stateOf = (key: string | null | undefined) =>
  STATE[key ?? ''] ?? { label: key ?? '—', tone: 'neutral' as Tone };

export const LETTER_TYPE: Record<string, string> = {
  OFFER: 'Offer letter',
  EXPERIENCE: 'Experience letter',
  REFERENCE: 'Reference letter',
  CERTIFICATE: 'Certificate',
};
export const typeLabel = (t: string) => LETTER_TYPE[t] ?? t;

/** Titles for what happened to a signature request, for the timeline. */
export const REQUEST_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: 'Waiting for the candidate', tone: 'warning' },
  COMPLETED: { label: 'Accepted', tone: 'success' },
  DECLINED: { label: 'Declined', tone: 'danger' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};
export const EVENT_LABEL: Record<string, string> = {
  requested: 'Link sent to the candidate',
  link_opened: 'Candidate opened the link',
  otp_sent: 'Code sent to the candidate',
  otp_verified: 'Candidate entered the code',
  accepted: 'Candidate accepted',
  declined: 'Candidate declined',
  cancelled: 'Request cancelled',
  sealed: 'Document sealed',
};
export const eventLabel = (t: string) => EVENT_LABEL[t] ?? t.replace(/_/g, ' ');

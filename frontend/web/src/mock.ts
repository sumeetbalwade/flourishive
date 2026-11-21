// Prototype data only. Replaced by the API in Phase 1/2.
export type LetterStatus = 'draft' | 'awaiting' | 'otp' | 'signed' | 'accepted' | 'failed';

export type Letter = {
  id: string;
  person: string;
  role: string;
  type: string;
  status: LetterStatus;
  updated: string;
  ref: string;
};

export const LETTERS: Letter[] = [
  {
    id: 'l1',
    person: 'Riya Patil',
    role: 'Intern, Engineering',
    type: 'Internship offer',
    status: 'accepted',
    updated: '19 Nov, 10:42',
    ref: 'FS/HR/2026/0412',
  },
  {
    id: 'l2',
    person: 'Arjun Rao',
    role: 'Executive, Sales',
    type: 'Offer letter',
    status: 'awaiting',
    updated: '19 Nov, 09:15',
    ref: 'FS/HR/2026/0413',
  },
  {
    id: 'l3',
    person: 'Meera Kulkarni',
    role: 'Designer',
    type: 'Experience letter',
    status: 'failed',
    updated: '18 Nov, 17:03',
    ref: 'FS/HR/2026/0409',
  },
  {
    id: 'l4',
    person: 'Kabir Shah',
    role: 'Intern, Marketing',
    type: 'Internship certificate',
    status: 'signed',
    updated: '18 Nov, 12:30',
    ref: 'FS/HR/2026/0410',
  },
  {
    id: 'l5',
    person: 'Sana Sheikh',
    role: 'Analyst',
    type: 'Offer letter',
    status: 'draft',
    updated: '17 Nov, 16:48',
    ref: 'FS/HR/2026/0414',
  },
  {
    id: 'l6',
    person: 'Dev Joshi',
    role: 'Developer',
    type: 'Appointment letter',
    status: 'otp',
    updated: '17 Nov, 11:20',
    ref: 'FS/HR/2026/0411',
  },
];

export const STATUS: Record<
  LetterStatus,
  { label: string; tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' }
> = {
  draft: { label: 'Draft', tone: 'neutral' },
  awaiting: { label: 'Awaiting signature', tone: 'accent' },
  signed: { label: 'Signed, sent', tone: 'info' },
  otp: { label: 'Awaiting candidate OTP', tone: 'warning' },
  accepted: { label: 'Accepted', tone: 'success' },
  failed: { label: 'Signing failed', tone: 'danger' },
};

export const TIMELINE = [
  {
    t: '19 Nov, 09:02',
    what: 'Letter generated from "Offer letter v3"',
    who: 'Noah Brooks',
    done: true,
  },
  {
    t: '19 Nov, 09:15',
    what: 'Signed with DSC (Class 3), RFC 3161 timestamp added',
    who: 'Desktop app',
    done: true,
  },
  {
    t: '19 Nov, 09:16',
    what: 'Emailed to the candidate with an OTP link',
    who: 'System',
    done: true,
  },
  { t: '19 Nov, 10:42', what: 'Candidate accepted with email OTP', who: 'Riya Patil', done: true },
  { t: 'Pending', what: 'Countersigned copy archived', who: 'System', done: false },
];

import { z } from 'zod';

export const stateDef = z.object({
  key: z.string().min(1).max(60),
  label: z.string().min(1).max(80),
  /** No actions leave a final state. */
  final: z.boolean().default(false),
  /** Hours before the people who can act on this state are reminded (sent in a later PR). */
  reminderAfterHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .optional(),
});

export const transitionDef = z.object({
  action: z.string().min(1).max(60),
  label: z.string().min(1).max(80),
  from: z.array(z.string()).min(1),
  to: z.string(),
  /** Needed to take this action. Left out for steps only the system takes. */
  permission: z.string().optional(),
  /** Only code (for example the signing steps) may take it, never a person through the API. */
  system: z.boolean().default(false),
  commentRequired: z.boolean().default(false),
  /** The person who took this earlier action may not also take this one (four eyes). */
  differentPersonFrom: z.string().optional(),
});

export const definitionSchema = z
  .object({
    initial: z.string(),
    states: z.array(stateDef).min(2),
    transitions: z.array(transitionDef).min(1),
  })
  .superRefine((d, ctx) => {
    const keys = new Set(d.states.map((s) => s.key));
    const bad = (m: string) => ctx.addIssue({ code: 'custom', message: m });
    if (keys.size !== d.states.length) bad('State keys must be unique');
    if (!keys.has(d.initial)) bad('The initial state does not exist');
    const finals = new Set(d.states.filter((s) => s.final).map((s) => s.key));
    const actions = new Set(d.transitions.map((t) => t.action));
    for (const t of d.transitions) {
      if (!keys.has(t.to)) bad(`${t.action}: unknown target ${t.to}`);
      for (const f of t.from) {
        if (!keys.has(f)) bad(`${t.action}: unknown source ${f}`);
        if (finals.has(f)) bad(`${t.action}: leaves the final state ${f}`);
      }
      if (!t.system && !t.permission)
        bad(`${t.action}: a person's action needs a permission`);
      if (t.differentPersonFrom && !actions.has(t.differentPersonFrom))
        bad(`${t.action}: unknown action ${t.differentPersonFrom}`);
    }
  });

export type WorkflowDefinitionData = z.infer<typeof definitionSchema>;
export type Transition = z.infer<typeof transitionDef>;

/** The letters flow: draft, submitted for approval, approved, signing, issued. */
export const LETTER_FLOW_KEY = 'letter';
export const LETTER_FLOW: WorkflowDefinitionData = {
  initial: 'draft',
  states: [
    { key: 'draft', label: 'Draft', final: false },
    {
      key: 'submitted',
      label: 'Waiting for approval',
      final: false,
      reminderAfterHours: 24,
    },
    { key: 'changes_requested', label: 'Changes requested', final: false },
    { key: 'approved', label: 'Approved', final: false },
    { key: 'signing', label: 'Being signed', final: false },
    { key: 'issued', label: 'Issued', final: true },
    { key: 'cancelled', label: 'Cancelled', final: true },
  ],
  transitions: [
    {
      action: 'submit',
      label: 'Submit for approval',
      from: ['draft', 'changes_requested'],
      to: 'submitted',
      permission: 'documents.generate',
      system: false,
      commentRequired: false,
    },
    {
      action: 'approve',
      label: 'Approve',
      from: ['submitted'],
      to: 'approved',
      permission: 'documents.approve',
      system: false,
      commentRequired: false,
      differentPersonFrom: 'submit',
    },
    {
      action: 'request_changes',
      label: 'Ask for changes',
      from: ['submitted'],
      to: 'changes_requested',
      permission: 'documents.approve',
      system: false,
      commentRequired: true,
    },
    {
      action: 'cancel',
      label: 'Cancel',
      from: ['draft', 'submitted', 'changes_requested', 'approved'],
      to: 'cancelled',
      permission: 'documents.generate',
      system: false,
      commentRequired: true,
    },
    {
      action: 'start_signing',
      label: 'Start signing',
      from: ['approved'],
      to: 'signing',
      system: true,
      commentRequired: false,
    },
    {
      action: 'signing_failed',
      label: 'Signing failed',
      from: ['signing'],
      to: 'approved',
      system: true,
      commentRequired: false,
    },
    {
      action: 'issue',
      label: 'Issue',
      from: ['signing'],
      to: 'issued',
      system: true,
      commentRequired: false,
    },
  ],
};

import { z } from 'zod';

export const ORG_KINDS = ['locations', 'departments', 'designations'] as const;
export type OrgKind = (typeof ORG_KINDS)[number];

const name = z.string().trim().min(1).max(100);
export const orgBodies = {
  locations: z.object({
    name,
    city: z.string().trim().max(100).nullish(),
    state: z.string().trim().max(100).nullish(),
  }),
  departments: z.object({ name }),
  designations: z.object({ name }),
} satisfies Record<OrgKind, z.ZodType>;

export const orgItem = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  _count: z.object({ engagements: z.number() }),
});
export const orgList = z.array(orgItem);
export type OrgItem = z.infer<typeof orgItem>;

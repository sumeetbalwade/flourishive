import { z } from 'zod';

export type SettingLevel = 'user' | 'entity' | 'tenant';

export interface SettingDefinition<T = unknown> {
  schema: z.ZodType<T>;
  default: T;
  /** Levels at which the value may be overridden (platform default is always possible). */
  levels: SettingLevel[];
  description: string;
}

function def<T>(d: SettingDefinition<T>): SettingDefinition<T> {
  return d;
}

/** Every setting is declared once here. Add new ones as modules need them. */
export const SETTINGS = {
  'branding.accentColor': def({
    schema: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    default: '#c4914f',
    levels: ['tenant', 'entity'],
    description: 'Accent colour used across the tenant’s screens',
  }),
  'branding.defaultTheme': def({
    schema: z.enum(['dark', 'light', 'system']),
    default: 'dark',
    levels: ['tenant', 'user'],
    description: 'Default colour theme',
  }),
  'branding.emailSenderName': def({
    schema: z.string().min(1).max(80),
    default: 'Flourishive',
    levels: ['tenant', 'entity'],
    description: 'Sender name on emails',
  }),
  'security.passwordMinLength': def({
    schema: z.number().int().min(8).max(64),
    default: 12,
    levels: ['tenant'],
    description: 'Minimum password length',
  }),
  'security.mfaPolicy': def({
    schema: z.enum(['privileged', 'everyone']),
    default: 'privileged',
    levels: ['tenant'],
    description: 'Who must use MFA: only roles that require it, or every user',
  }),
  'security.sessionDays': def({
    schema: z.number().int().min(1).max(30),
    default: 14,
    levels: ['tenant'],
    description: 'How long a sign-in lasts without activity',
  }),
} satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValueOf<K extends SettingKey> = z.infer<
  (typeof SETTINGS)[K]['schema']
>;
export const isSettingKey = (k: string): k is SettingKey => k in SETTINGS;

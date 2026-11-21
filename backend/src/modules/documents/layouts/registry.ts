import type { FieldDef } from '@flourishive/schemas';
import type { DocumentProps } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import type { ZodType } from 'zod';

export interface BodyProps {
  content: Record<string, string>;
  orientation: 'PORTRAIT' | 'LANDSCAPE';
  margins: { top: number; bottom: number; left: number; right: number };
}

/** A layout drawn in code. HR edits only the text fields it declares. */
export interface Layout {
  key: string;
  label: string;
  orientation: 'PORTRAIT' | 'LANDSCAPE';
  contentSchema: ZodType<Record<string, string>>;
  defaultContent: Record<string, string>;
  defaultFields: FieldDef[];
  /** The document element; pages must have a transparent background (the letterhead goes behind). */
  render(props: BodyProps): ReactElement<DocumentProps>;
}

import { certificateLayout } from './certificate.js';
import { letterLayout } from './letter.js';

export const LAYOUTS: Record<string, Layout> = {
  [letterLayout.key]: letterLayout,
  [certificateLayout.key]: certificateLayout,
};

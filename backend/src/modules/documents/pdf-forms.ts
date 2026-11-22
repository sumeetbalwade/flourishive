import { BadRequestException } from '@nestjs/common';
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFRadioGroup,
  PDFTextField,
} from 'pdf-lib';

export type PdfFormField = {
  name: string;
  type: 'text' | 'checkbox' | 'dropdown' | 'radio';
};

export interface PdfInfo {
  pageCount: number;
  landscape: boolean;
  fields: PdfFormField[];
}

const MAX_PAGES = 30;

/** Reads a PDF an HR person uploaded: its shape and any fillable form fields. */
export async function inspectPdf(bytes: Buffer): Promise<PdfInfo> {
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-')
    throw new BadRequestException('That is not a PDF');
  try {
    const pdf = await PDFDocument.load(bytes);
    const pageCount = pdf.getPageCount();
    if (pageCount < 1 || pageCount > MAX_PAGES)
      throw new BadRequestException(
        `The PDF must have 1 to ${MAX_PAGES} pages`,
      );
    const size = pdf.getPage(0).getSize();
    const fields: PdfFormField[] = [];
    for (const f of pdf.getForm().getFields()) {
      const type =
        f instanceof PDFTextField
          ? 'text'
          : f instanceof PDFCheckBox
            ? 'checkbox'
            : f instanceof PDFDropdown
              ? 'dropdown'
              : f instanceof PDFRadioGroup
                ? 'radio'
                : null;
      if (type) fields.push({ name: f.getName(), type });
    }
    return { pageCount, landscape: size.width > size.height, fields };
  } catch (e) {
    if (e instanceof BadRequestException) throw e;
    throw new BadRequestException(
      'That PDF could not be read. If it is password protected, remove the password first.',
    );
  }
}

const YES = new Set(['yes', 'y', 'true', '1', 'checked', 'x']);

/**
 * Puts values into the form fields named in `mapping` (PDF field name to our field key), then flattens
 * the form so the result is plain page content that cannot be edited.
 */
export async function fillAndFlatten(
  bytes: Buffer,
  mapping: Record<string, string>,
  values: Record<string, string>,
): Promise<Buffer> {
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  for (const [pdfName, key] of Object.entries(mapping)) {
    const value = values[key] ?? '';
    let field;
    try {
      field = form.getField(pdfName);
    } catch {
      continue; // the field is gone from this PDF; leave it
    }
    if (field instanceof PDFTextField) field.setText(value);
    else if (field instanceof PDFCheckBox) {
      if (YES.has(value.trim().toLowerCase())) field.check();
      else field.uncheck();
    } else if (field instanceof PDFDropdown || field instanceof PDFRadioGroup) {
      if (field.getOptions().includes(value)) field.select(value);
    }
  }
  form.flatten();
  return Buffer.from(await pdf.save());
}

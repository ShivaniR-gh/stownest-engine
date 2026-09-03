import type { ColumnDef, DatasetDef, Row } from '../../src/config/types';

/** ---------------------------------------------------------------------------
 * Field validation, shared by the browser and the API.
 *
 * The form imports this so the user sees an error before submitting; the
 * serverless function imports the SAME code so the check cannot be bypassed by
 * calling the API directly. One implementation means the two can never drift
 * into disagreeing about what is valid.
 * ------------------------------------------------------------------------- */

export interface FieldError { key: string; message: string }

const num = (v: unknown) => Number(String(v ?? '').replace(/[₹,\s]/g, ''));

/** Validates one value against one column. Returns null when acceptable. */
export function validateField(c: ColumnDef, raw: unknown): string | null {
  const s = String(raw ?? '').trim();

  if (c.required && !s) return `${c.header} is required.`;
  if (!s) return null; // optional and empty — nothing further to check

  if (s.length > 2000) return `${c.header} is too long.`;

  if (c.type === 'number' || c.type === 'currency' || c.type === 'percent') {
    const n = num(s);
    if (Number.isNaN(n)) return `${c.header} must be a number.`;
    if (c.min !== undefined && n < c.min) return `${c.header} must be at least ${c.min}.`;
    if (c.max !== undefined && n > c.max) return `${c.header} must be at most ${c.max}.`;
  }

  if (c.type === 'date' || c.type === 'datetime') {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return `${c.header} must be a valid date.`;
  }

  if (c.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) {
    return `${c.header} must be a valid email address.`;
  }

  if (c.enumValues?.length && !c.enumValues.includes(s)) {
    return `${c.header} must be one of: ${c.enumValues.join(', ')}.`;
  }

  if (c.pattern && !new RegExp(c.pattern).test(s)) {
    return c.patternHint
      ? `${c.header} is not in the expected format (${c.patternHint}).`
      : `${c.header} is not in the expected format.`;
  }

  return null;
}

/**
 * Validates a whole submission.
 *
 * Iterates the SCHEMA, never the request body, so a crafted payload cannot
 * introduce a field the config does not define. `isUpdate` skips required
 * checks on fields the caller did not send, since a PATCH is partial.
 */
export function validateRecord(ds: DatasetDef, values: Row, isUpdate = false): FieldError[] {
  const errors: FieldError[] = [];

  for (const c of ds.columns) {
    if (!c.sheetColumn) continue;      // unmapped columns are never written
    if (c.derived) continue;           // filled by the server, not the user
    if (isUpdate && !(c.key in values)) continue;

    const msg = validateField(c, values[c.key]);
    if (msg) errors.push({ key: c.key, message: msg });
  }

  // Cross-field rules. The existing PAN INDIA sheet has rows this would have
  // caught: HYD:003 records 20000 total, 20000 occupied and 800 available.
  for (const rule of ds.crossFieldRules ?? []) {
    const msg = rule(values);
    if (msg) errors.push(msg);
  }

  return errors;
}

/** Neutralises spreadsheet formula injection. A value beginning = + - or @
 *  executes as a formula once written, so it is prefixed with an apostrophe. */
export function escapeForSheet(s: string): string {
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

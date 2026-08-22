import type { ColumnDef, Row } from '@/config/types';
import { formatCell } from '@/lib/format';

const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** CSV honouring the visible columns and the current sort/filter — what you
 *  see on screen is exactly what lands in the file. Excel-compatible: a BOM is
 *  prepended so ₹ and Indian names survive the default Excel import. */
export function toCSV(rows: Row[], columns: ColumnDef[], opts: { raw?: boolean } = {}): string {
  const head = columns.map(c => esc(c.header)).join(',');
  const body = rows.map(r =>
    columns.map(c => esc(opts.raw ? String(r[c.key] ?? '') : formatCell(r[c.key], c.type))).join(','),
  );
  return [head, ...body].join('\r\n');
}

export function download(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([mime.startsWith('text/csv') ? '\uFEFF' + content : content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

export function exportRows(name: string, rows: Row[], columns: ColumnDef[]) {
  download(`stownest-${name}-${stamp()}.csv`, toCSV(rows, columns));
}

/** Uses the browser print pipeline for PDF. No client-side PDF library, so
 *  nothing to keep in sync with the design system — @media print rules do it. */
export const printReport = () => window.print();

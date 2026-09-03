/** ---------------------------------------------------------------------------
 * Month tab naming.
 *
 * Tab names are generated here and nowhere else. The existing PAN INDIA
 * workbook shows what happens without one source of truth: SEPT 2024, Nove
 * 2024, Oct 2025, JAN 2026 END, may 2026 — five different conventions in one
 * file, none of which a program can resolve reliably.
 *
 * Format: "<prefix> MMM YYYY" in uppercase, e.g. "Readings MAR 2026".
 * The prefix lets several monthly datasets share one workbook without their
 * March tabs colliding.
 * ------------------------------------------------------------------------- */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

export function monthTabName(prefix: string, year: number, monthIndex0: number): string {
  const m = MONTHS[monthIndex0];
  if (!m) throw new Error(`Month index out of range: ${monthIndex0}`);
  return `${prefix} ${m} ${year}`.trim();
}

/**
 * The CLOSED set of tabs a monthly dataset may be written to, computed on the
 * server from today's date.
 *
 * This is a security boundary, not a convenience. The destination tab arrives
 * from the browser; if arbitrary names were accepted, a crafted request could
 * append a row to ANY tab in the workbook. Where a dataset points at the
 * control workbook that includes access_control, and a row there grants a
 * role — an employee with CREATE could make themselves a super admin.
 *
 * Bounding the window also stops a typo creating a tab years out that nobody
 * notices until the totals stop reconciling.
 */
export function monthTabOptions(
  prefix: string,
  opts: { back?: number; forward?: number; now?: Date } = {},
): string[] {
  const { back = 24, forward = 1, now = new Date() } = opts;
  const out: string[] = [];
  for (let i = -back; i <= forward; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push(monthTabName(prefix, d.getFullYear(), d.getMonth()));
  }
  return out.reverse(); // newest first — the month being entered is usually recent
}

/** Splits "Readings MAR 2026" back into its parts, for sorting and display. */
export function parseMonthTab(tab: string): { year: number; month0: number } | null {
  const m = /\b([A-Z]{3})\s+(\d{4})\s*$/i.exec(tab.trim());
  if (!m) return null;
  const idx = MONTHS.indexOf(m[1].toUpperCase() as typeof MONTHS[number]);
  if (idx < 0) return null;
  return { year: Number(m[2]), month0: idx };
}

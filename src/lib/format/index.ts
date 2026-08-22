import type { ColumnType, MetricFormat } from '@/config/types';

/** Indian numbering: 12,34,567 not 1,234,567. */
const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatINR = (n: number, decimals = false) =>
  `₹${(decimals ? inr2 : inr0).format(n)}`;

/** Lakh/crore short form. Management reads ₹1.24 Cr, not ₹12,40,00,000. */
export function formatINRCompact(n: number): string {
  const a = Math.abs(n), sign = n < 0 ? '−' : '';
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(a / 1e7 >= 100 ? 0 : 2)} Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(a / 1e5 >= 100 ? 0 : 2)} L`;
  if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(a / 1e3 >= 100 ? 0 : 1)} K`;
  return `${sign}₹${inr0.format(a)}`;
}

export const formatInt = (n: number) => inr0.format(Math.round(n));
export const formatPct = (n: number, dp = 1) => `${n.toFixed(dp)}%`;

export function formatCompactNum(n: number): string {
  const a = Math.abs(n), sign = n < 0 ? '−' : '';
  if (a >= 1e7) return `${sign}${(a / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${sign}${(a / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  return `${sign}${inr0.format(a)}`;
}

export function formatMetric(v: number, f: MetricFormat): string {
  switch (f) {
    case 'inr': return formatINR(v);
    case 'inr_compact': return formatINRCompact(v);
    case 'int': return formatInt(v);
    case 'pct': return formatPct(v);
    case 'pp': return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} pp`;
    case 'days': return `${v.toFixed(1)}`;
    case 'decimal': return v.toFixed(2);
    default: return String(v);
  }
}

/* --------------------------------- dates -------------------------------- */
export function parseDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') {
    // Google Sheets serial date (days since 1899-12-30)
    if (v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000));
    return null;
  }
  if (typeof v !== 'string' || !v.trim()) return null;
  const s = v.trim();
  // dd/mm/yyyy and dd-mm-yyyy — the Indian sheet default. Checked before Date.parse,
  // which would read 03/04/2025 as March 4th.
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) {
    const d = new Date(+m[3], +m[2] - 1, +m[1]);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

export const fmtDate = (v: unknown) => {
  const d = parseDate(v);
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
};
export const fmtDateShort = (v: unknown) => {
  const d = parseDate(v);
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '';
};
export const fmtDateTime = (v: unknown) => {
  const d = parseDate(v);
  return d ? d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
};
export const toISODate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function relativeTime(iso: string | number | null): string {
  if (iso === null) return 'never';
  const then = typeof iso === 'number' ? iso : Date.parse(iso);
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const m = Math.round(secs / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/* ------------------------------ cell display ---------------------------- */
export function formatCell(v: unknown, type: ColumnType): string {
  if (v === null || v === undefined || v === '') return '';
  switch (type) {
    case 'currency': {
      const n = toNum(v);
      return n === null ? String(v) : formatINR(n);
    }
    case 'number': {
      const n = toNum(v);
      return n === null ? String(v) : formatInt(n);
    }
    case 'percent': {
      const n = toNum(v);
      return n === null ? String(v) : formatPct(n);
    }
    case 'date': return fmtDate(v) || String(v);
    case 'datetime': return fmtDateTime(v) || String(v);
    case 'boolean': return v === true || v === 'TRUE' || v === 'Yes' ? 'Yes' : 'No';
    default: return String(v);
  }
}

export function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const n = parseFloat(v.replace(/[₹,\s%]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export const isNumericType = (t: ColumnType) => t === 'currency' || t === 'number' || t === 'percent';
export const isMonoType = (t: ColumnType) => t === 'id' || t === 'date' || t === 'datetime' || t === 'phone';

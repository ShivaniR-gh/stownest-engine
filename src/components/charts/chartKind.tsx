import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/** ---------------------------------------------------------------------------
 * Page-wide chart type.
 *
 * One switch per page sets how every chart on it is drawn. 'default' is each
 * chart as its dashboard designed it, and is what everyone sees until they
 * pick something else. The chart components (TrendChart, CategoryChart,
 * DonutChart, StackedBarChart) read this and re-plot the SAME data, so a
 * switch only ever changes the shape, never the numbers.
 *
 * Outside a ChartKindProvider every chart is drawn as designed, so pages that
 * do not opt in are unaffected.
 * ------------------------------------------------------------------------- */
export type ChartKind = 'default' | 'bar' | 'hbar' | 'line' | 'area' | 'pie';

export const CHART_KINDS: { id: ChartKind; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'bar', label: 'Bar' },
  { id: 'hbar', label: 'Horizontal bar' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'pie', label: 'Pie' },
];

const isKind = (v: unknown): v is ChartKind => CHART_KINDS.some(k => k.id === v);

interface KindCtx { kind: ChartKind; setKind: (k: ChartKind) => void; live: boolean }
const Ctx = createContext<KindCtx | null>(null);
const AS_DESIGNED: KindCtx = { kind: 'default', setKind: () => {}, live: false };

const storeKey = (scope: string) => `chartKind:${scope}`;
function load(scope: string): ChartKind {
  try {
    const v = localStorage.getItem(storeKey(scope));
    return isKind(v) ? v : 'default';
  } catch { return 'default'; }
}

/** Holds the choice for one page. `scope` keeps each page's choice separate
 *  and remembered in this browser; blocked storage only means it is not kept. */
export function ChartKindProvider({ scope, children }: { scope: string; children: ReactNode }) {
  const [kind, setKindState] = useState<ChartKind>(() => load(scope));
  useEffect(() => { setKindState(load(scope)); }, [scope]);

  const setKind = useCallback((k: ChartKind) => {
    setKindState(k);
    try {
      if (k === 'default') localStorage.removeItem(storeKey(scope));
      else localStorage.setItem(storeKey(scope), k);
    } catch { /* not kept */ }
  }, [scope]);

  const value = useMemo(() => ({ kind, setKind, live: true }), [kind, setKind]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChartKind(): ChartKind {
  return useContext(Ctx)?.kind ?? 'default';
}

/** Wraps a chart that one chart component renders on behalf of another, so
 *  the inner chart draws exactly what it is told instead of re-applying the
 *  page choice (and a TrendChart→CategoryChart→TrendChart loop is impossible). */
export function AsDesigned({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={AS_DESIGNED}>{children}</Ctx.Provider>;
}

/** Segmented control. Renders nothing outside a provider, so it can be placed
 *  in shared headers without appearing on pages that have not opted in. */
export function ChartKindSwitch() {
  const c = useContext(Ctx);
  if (!c || !c.live) return null;
  return (
    <span className="chartkind-bar">
      <span className="chartkind-bar__lb">Chart type</span>
      <span className="chartkind-seg" role="radiogroup" aria-label="Chart type">
        {CHART_KINDS.map(k => (
          <button key={k.id} type="button" role="radio" aria-checked={c.kind === k.id}
            className="chartkind-seg__btn" data-on={c.kind === k.id || undefined}
            onClick={() => c.setKind(k.id)}>
            {k.label}
          </button>
        ))}
      </span>
    </span>
  );
}

/** Heading row for a charts section that has no heading of its own: same
 *  look as "Utilisation status", with the switch on the right. */
export function ChartsHeading({ title = 'Charts' }: { title?: string }) {
  return (
    <div className="chartkind-hd">
      <h3 className="cef__sec">{title}</h3>
      <ChartKindSwitch />
    </div>
  );
}

/* ---------------------------- helpers for charts --------------------------- */

/** True when a value formatter prints a percentage. Slices of percentages do
 *  not add up to anything, so a pie of them must not show a total. */
export function isPercentFormat(f: (n: number) => string): boolean {
  try { return /%\s*$/.test(f(50)); } catch { return false; }
}

export const shortLabel = (s: string, n = 12) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

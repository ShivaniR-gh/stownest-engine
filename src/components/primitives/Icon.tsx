/** A single 16px stroked icon set. One family, one weight, no decoration —
 *  every glyph here is attached to an action or a state. */
const P: Record<string, string> = {
  overview: 'M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z',
  trending: 'M3 17l6-6 4 4 7-7M17 8h4v4',
  truck: 'M1 4h11v11H1zM12 8h4l4 4v3h-8M4 19a2 2 0 104 0 2 2 0 10-4 0M15 19a2 2 0 104 0 2 2 0 10-4 0',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v10',
  checklist: 'M9 5h11M9 12h11M9 19h11M3.5 5l1.5 1.5L8 3.5M3.5 12L5 13.5 8 10.5M3.5 19L5 20.5 8 17.5',
  radar: 'M12 3a9 9 0 109 9M12 7a5 5 0 105 5M12 12l7-7',
  receipt: 'M5 2v20l3-2 2 2 2-2 2 2 2-2 3 2V2zM9 8h6M9 12h6M9 16h4',
  ledger: 'M4 3h16v18H4zM8 3v18M12 8h5M12 12h5M12 16h3',
  shield: 'M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z',
  users: 'M16 20v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 3a4 4 0 100 8 4 4 0 000-8M22 20v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8',
  chart: 'M3 3v18h18M7 15v3M12 9v9M17 12v6',
  report: 'M14 2H6v20h12V6zM14 2v4h4M9 13h6M9 17h4',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2v.2a2 2 0 11-4 0v-.1a1.7 1.7 0 00-3-1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00-1.2-2.9H3a2 2 0 110-4h.1A1.7 1.7 0 004.3 7l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V2a2 2 0 114 0v.1a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H22a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  present: 'M2 3h20v13H2zM8 21l4-5 4 5M12 3V1',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14M20 20l-4-4',
  filter: 'M3 4h18l-7 8v7l-4 2v-9z',
  calendar: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
  refresh: 'M21 12a9 9 0 11-2.6-6.4M21 3v6h-6',
  download: 'M12 3v12M7 11l5 5 5-5M3 20h18',
  plus: 'M12 5v14M5 12h14',
  chevronDown: 'M5 9l7 7 7-7',
  chevronRight: 'M9 5l7 7-7 7',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronUp: 'M19 15l-7-7-7 7',
  close: 'M6 6l12 12M18 6L6 18',
  more: 'M12 6h.01M12 12h.01M12 18h.01',
  edit: 'M4 20h4L20 8l-4-4L4 16zM14 6l4 4',
  trash: 'M4 6h16M9 6V4h6v2M6 6l1 15h10l1-15M10 11v6M14 11v6',
  check: 'M4 12l5 5L20 6',
  alert: 'M12 3l10 18H2zM12 9v5M12 18h.01',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18M12 11v6M12 7h.01',
  panelLeft: 'M3 3h18v18H3zM9 3v18',
  expand: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
  columns: 'M3 3h18v18H3zM9 3v18M15 3v18',
  external: 'M18 13v6H5V6h6M14 3h7v7M10 14L21 3',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  arrowDown: 'M12 5v14M19 12l-7 7-7-7',
  layers: 'M12 2L2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18M12 7v5l3 2',
  logout: 'M9 21H4V3h5M16 17l5-5-5-5M21 12H9',
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 16, className, strokeWidth = 1.6, style }: {
  name: string; size?: number; className?: string; strokeWidth?: number;
  style?: React.CSSProperties;
}) {
  const d = P[name] ?? P.info;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={className} style={style} aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

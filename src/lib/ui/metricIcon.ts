/**
 * Which icon represents a metric, chosen from what the metric MEANS.
 *
 * Shared by MetricCard (the config-driven KPI grid) and KpiTile (the
 * hand-built department dashboards) so the two never drift: "Occupied sqft"
 * gets the same glyph on Facility as it does on B2B.
 *
 * Order matters — the most specific reading wins. "Customer churn" is a
 * churn metric, not a customer metric, so churn is tested first; likewise
 * total / occupied / available each need their own rule before the generic
 * space match, or a capacity row renders as three identical icons.
 */
const ICON_RULES: [RegExp, string][] = [
  [/utilis|occupancy rate|fill rate/i, 'chart'],
  [/churn|lost|vacated|exit/i, 'logout'],
  [/gap|difference|net\b|variance/i, 'trending'],
  [/available|free|vacant|spare|remaining/i, 'columns'],
  [/occupied|used/i, 'box'],
  [/warehouse|facility|site|location/i, 'overview'],
  [/new\b|added|onboard/i, 'plus'],
  [/customer|client|tenant|user/i, 'users'],
  [/revenue|income|collected|raised|paid|profit|spend|cost|price|outstanding|pending|payout|pbt|ebitda|tax|expense|invoice|billing|balance|amount|value|order/i, 'ledger'],
  [/lead|enquir|conver/i, 'trending'],
  [/deliver|pickup|pick-up|moving|move|transport|trip|transaction/i, 'truck'],
  [/full|complete/i, 'check'],
  [/partial|add\s?on/i, 'columns'],
  [/ticket|issue|complaint|damage|missed/i, 'alert'],
  [/call|contact|review/i, 'users'],
  [/rate|percentage|share|growth/i, 'chart'],
  [/total|capacity|space|sqft|area|count/i, 'layers'],
];

/** Falls back to `layers` — a neutral "some quantity" mark — when nothing
 *  in the text is recognisable. */
export function iconForLabel(text: string, fallback = 'layers'): string {
  for (const [re, name] of ICON_RULES) if (re.test(text)) return name;
  return fallback;
}

import type { DatasetDef, Row } from '../../src/config/types';
import type { Principal } from '../../src/lib/permissions/policy';
import { HttpError } from './env';
import { readDataset } from './sheets';
import { getDatasetDef } from './registry';

/** ---------------------------------------------------------------------------
 * Server-side field derivation.
 *
 * Some columns are written by the server rather than the user: figures computed
 * from what was entered, facts copied from a master record, audit stamps. They
 * live here rather than in the form because a value the browser calculates is a
 * value the browser can lie about.
 *
 * Derivation runs AFTER validation and AFTER the permission check.
 * ------------------------------------------------------------------------- */

export type Deriver = (
  values: Row,
  ctx: { principal: Principal; tab: string },
) => Promise<Row>;

/**
 * Sales city figures. Identical for storage, moving and business, so it is
 * written once and registered three times — three copies would drift the first
 * time someone fixed a rule in one of them.
 *
 * Only four values per city are entered. Conversion and total are arithmetic
 * over them, so the server computes both and the browser's copies are
 * overwritten: a stale tab cannot write a total that disagrees with the orders
 * and add-ons beside it.
 *
 * Checked against the August report: 163 orders + 29 add-ons = 192 total, and
 * 163 / 526 leads = 31%.
 */
const SALES_CITY_KEYS = ['blr', 'hyd', 'che', 'mum', 'pun', 'del', 'kol'];

const salesCityDerive: Deriver = async (values, { principal }) => {
  const out: Row = { ...values };
  let totLeads = 0, totOrders = 0, totValue = 0, totAddon = 0;

  for (const c of SALES_CITY_KEYS) {
    const leads = num(values[`${c}_leads`]);
    const orders = num(values[`${c}_orders`]);
    const value = num(values[`${c}_value`]);
    const addon = num(values[`${c}_addon`]);

    if (leads < 0 || orders < 0 || value < 0 || addon < 0) {
      throw new HttpError(400, `Figures for ${c.toUpperCase()} cannot be negative.`);
    }
    if (orders > leads && leads > 0) {
      throw new HttpError(400,
        `${c.toUpperCase()}: ${orders} orders cannot exceed ${leads} leads.`);
    }

    out[`${c}_conv`] = leads > 0 ? ((orders / leads) * 100).toFixed(2) : '0';
    out[`${c}_total`] = String(orders + addon);

    totLeads += leads; totOrders += orders; totValue += value; totAddon += addon;
  }

  return {
    ...out,
    tot_leads: String(totLeads),
    tot_orders: String(totOrders),
    tot_conv: totLeads > 0 ? ((totOrders / totLeads) * 100).toFixed(2) : '0',
    tot_value: String(totValue),
    tot_addon: String(totAddon),
    tot_total: String(totOrders + totAddon),
    entered_by: principal.email,
  };
};

const DERIVERS: Record<string, Deriver> = {

  /**
   * A space reading stores wh_code, occupied_space and the three customer
   * counts from the user. Everything else is derived:
   *
   *  - wh_name / city / location / total_space are SNAPSHOT from the warehouse
   *    master at write time. Snapshotting rather than joining is deliberate:
   *    when a warehouse is expanded from 11,247 to 15,000 sqft in June, March's
   *    reading must keep showing 11,247. A live join would silently rewrite
   *    every past month's utilisation and reshape the trend chart.
   *
   *  - available_space and utilisation_pct are computed, never entered. The
   *    source sheet has rows where these disagree with the figures above them.
   *
   *  - opening_customers and churn_pct are computed from the three counts.
   *    Churn divides by the OPENING balance, not the closing total: whoever
   *    joined this month was never at risk of leaving it, so including them in
   *    the denominator understates the rate. Deriving the opening from the
   *    three entered figures keeps a month self-contained — it can be
   *    corrected without reading its neighbour — and doubles as a check, since
   *    it should equal last month's closing total.
   */
  warehouse_readings: async (values, { principal }) => {
    const code = String(values.wh_code ?? '').trim();
    if (!code) throw new HttpError(400, 'A warehouse must be selected.');

    const master = await getDatasetDef('warehouses');
    const { rows } = await readDataset(master);
    const wh = rows.find(r => String(r.wh_code ?? '').trim() === code);

    if (!wh) {
      throw new HttpError(400,
        `Warehouse "${code}" is not in the warehouse list. Ask an admin to add it first.`);
    }
    if (String(wh.status ?? 'Active').trim().toLowerCase() === 'inactive') {
      throw new HttpError(400, `Warehouse "${code}" is marked inactive and cannot take new readings.`);
    }

    const total = Number(String(wh.total_space ?? '').replace(/[,\s]/g, ''));
    const occupied = Number(String(values.occupied_space ?? '').replace(/[,\s]/g, ''));

    if (Number.isNaN(total) || total <= 0) {
      throw new HttpError(400, `Warehouse "${code}" has no valid total space recorded.`);
    }
    if (occupied > total) {
      throw new HttpError(400,
        `Occupied space (${occupied.toLocaleString('en-IN')}) cannot exceed this warehouse's total space of ${total.toLocaleString('en-IN')} sqft.`);
    }

    const totalCust = num(values.total_customers);
    const newCust = num(values.new_customers);
    const churned = num(values.churned_customers);
    const opening = totalCust - newCust + churned;

    if (opening < 0) {
      throw new HttpError(400,
        `${newCust} new and ${churned} left against a closing total of ${totalCust} ` +
        `implies a negative opening balance. One of the three is wrong.`);
    }

    return {
      ...values,
      wh_name:        String(wh.wh_name ?? ''),
      city:           String(wh.city ?? ''),
      location:       String(wh.location ?? ''),
      total_space:    String(total),
      occupied_space: String(occupied),
      available_space: String(total - occupied),
      utilisation_pct: total > 0 ? (occupied / total * 100).toFixed(1) : '0',
      recorded_on:    String(values.recorded_on ?? new Date().toISOString().slice(0, 10)),
      total_customers: String(totalCust),
      new_customers: String(newCust),
      churned_customers: String(churned),
      opening_customers: String(opening),
      churn_pct: opening > 0 ? ((churned / opening) * 100).toFixed(1) : '0',
      entered_by:     principal.email,
    };
  },

  /**
   * Every figure the sheet computes, recomputed here — except the two the team
   * now enters by hand: Pending collection amount and Pickup Gap in Rs. Those
   * pass through untouched, and the percentages beside them read the entered
   * value rather than recomputing it, so a deliberate override cannot be
   * contradicted by the number next to it.
   *
   * The employee enters the month totals and the two transportation segments;
   * storage is the remainder. The browser computes the same figures for its
   * live preview, but a value the browser calculates is a value the browser
   * can be wrong about, so the server has the last word.
   */
  collections_monthly: async (values) => {
    const raised = num(values.raised_amount);
    const collected = num(values.collection_month);
    if (collected > raised) {
      throw new HttpError(400, 'Collected this month cannot exceed the amount raised.');
    }

    const pkR = num(values.pk_raised), pkC = num(values.pk_collected);
    const dlR = num(values.dl_raised), dlC = num(values.dl_collected);
    const stR = raised - pkR - dlR;
    const stC = collected - pkC - dlC;
    if (stR < 0 || stC < 0) {
      throw new HttpError(400,
        'Pickup and delivery together exceed the month total, leaving storage rental negative.');
    }

    const pct = (part: number, whole: number) => (whole > 0 ? ((part / whole) * 100).toFixed(2) : '0');

    /**
     * A submitted value wins; the computed figure only fills a blank field.
     * Recomputing over what the team typed would let the percentage beside a
     * figure quietly contradict the figure itself.
     */
    const entered = (key: string, fallback: number) => {
      const raw = String(values[key] ?? '').trim();
      return raw === '' ? fallback : num(values[key]);
    };

    /**
     * Denominators follow the team's sheet.
     *
     *   Gap %            = Pending ÷ Raised × 100        (row 7,  =C6/C5*100)
     *   Segment gap %    = Gap ÷ Raised × 100            (row 17, =C16/C14*100)
     *   Share in revenue = Collected ÷ month's collected (row 18, =C15/C4*100)
     *
     * Verified against the columns that already hold values: March 6.678613,
     * April 7.426019, May 7.778137 all reproduce to six decimals. Dividing by
     * Collection Amount gives 5.10 / 6.54 / 6.36 for those months, which
     * matches nothing in the sheet — that figure covers collections against
     * everything outstanding while Pending covers this month alone, so it
     * mixes two periods. It is also what previously stopped the three shares
     * summing to 100%.
     */
    const pending = entered('pending_amount', raised - collected);
    const pkGap = entered('pk_gap', pkR - pkC);

    return {
      ...values,
      gap_pct: pct(pending, raised),
      pk_gap_pct: pct(pkGap, pkR), pk_share: pct(pkC, collected),
      dl_gap: String(dlR - dlC), dl_gap_pct: pct(dlR - dlC, dlR), dl_share: pct(dlC, collected),
      st_raised: String(stR), st_collected: String(stC),
      st_gap: String(stR - stC), st_gap_pct: pct(stR - stC, stR), st_share: pct(stC, collected),
    };
  },

  /**
   * B2C monthly report.
   *
   * The two totals are the sums of the city figures — the source report shows
   * 2.33Cr and 2.39Cr in both places, so typing them again is one more chance
   * for the two halves of one report to contradict each other.
   */
  collections_b2c_report: async (values, { principal }) => {
    const cities = ['blr', 'hyd', 'che', 'pun', 'mum', 'del', 'kol', 'gur'];
    const sum = (suffix: string) =>
      cities.reduce((a, c) => a + num(values[`${c}_${suffix}`]), 0);
    return {
      ...values,
      raised_amount: String(sum('invoice')),
      collection_amount: String(sum('collection')),
      entered_by: principal.email,
    };
  },

  /** Sales city performance — same rules for all three lines of business. */
  sales_storage: salesCityDerive,
  sales_moving: salesCityDerive,
  sales_business: salesCityDerive,

  /**
   * Lead totals. Valid + invalid per category, then the month roll-up.
   *
   * Nothing here needs another dataset, so it is pure arithmetic over what
   * was entered. The browser computes the same figures for the live preview,
   * but a value the browser calculates is a value the browser can be wrong
   * about, so these are what actually reach the sheet.
   */
  marketing_leads: async (values, { principal }) => {
    const cat = (p: string) => {
      const valid = num(values[`${p}_valid`]);
      const invalid = num(values[`${p}_invalid`]);
      if (valid < 0 || invalid < 0) {
        throw new HttpError(400, `Lead counts for ${p.toUpperCase()} cannot be negative.`);
      }
      return { valid, invalid, total: valid + invalid };
    };

    const b2b = cat('b2b');
    const b2c = cat('b2c');
    const pm = cat('pm');

    const totalValid = b2b.valid + b2c.valid + pm.valid;
    const totalInvalid = b2b.invalid + b2c.invalid + pm.invalid;
    const totalLeads = totalValid + totalInvalid;

    return {
      ...values,
      b2b_total: String(b2b.total),
      b2c_total: String(b2c.total),
      pm_total: String(pm.total),
      total_valid: String(totalValid),
      total_invalid: String(totalInvalid),
      total_leads: String(totalLeads),
      valid_rate_pct: totalLeads > 0 ? ((totalValid / totalLeads) * 100).toFixed(1) : '0',
      entered_by: principal.email,
    };
  },

  /**
   * Acquisition cost.
   *
   * Spend and customers are entered per category; every ratio below is
   * arithmetic over them and the month's lead counts:
   *
   *   CPL      = spend / total leads
   *   CPVL     = spend / valid leads
   *   CAC      = spend / customers
   *   L2C rate = customers / total leads
   *
   * Deriving rather than typing them is what keeps the row honest. A typed
   * CPL beside a typed spend can disagree, and nothing in the sheet would say
   * which was wrong; here the arithmetic only runs one way.
   *
   * This is the reverse of the earlier arrangement, which had the team typing
   * the three ratios because the ad accounts reported only one account-level
   * spend. They now report it per line of business, so the rupees are observed
   * and the ratios follow — which is the right way round.
   *
   * The blended figures are total spend over total leads, NOT an average of
   * the three CPLs. Averaging would weight a category bringing 226 leads the
   * same as one bringing 2,551, which is how a small expensive line makes the
   * whole month look expensive.
   *
   * The lead counts are read at write time and snapshotted. If someone
   * corrects March's leads in June, March's CPL as recorded stays what CPL was
   * understood to be when the month was closed — otherwise the figure would
   * still render while quietly describing a denominator that no longer exists.
   */
  marketing_acquisition: async (values, { principal }) => {
    const month = monthKey(values.month);
    if (!month) throw new HttpError(400, 'A month is required.');

    const leadsDs = await getDatasetDef('marketing_leads');
    const { rows } = await readDataset(leadsDs);
    const lead = rows.find(r => monthKey(r.month) === month);

    if (!lead) {
      throw new HttpError(400,
        `No lead performance row exists for ${month}. Enter the lead counts for that month first — ` +
        `cost per lead cannot be computed without them.`);
    }

    /** Blank rather than a misleading zero when the denominator is absent.
     *  A CPL of "0" reads as free; a blank reads as unknown, which is true. */
    const per = (a: number, b: number) => (b > 0 ? (a / b).toFixed(0) : '');
    const pct = (part: number, whole: number) => (whole > 0 ? ((part / whole) * 100).toFixed(1) : '');

    const out: Row = { ...values };
    let totalSpend = 0;
    let totalCustomers = 0;

        /**
     * Sheets is eventually consistent on read-after-write. The leads row is
     * written moments before this runs, so the read above can return the
     * month's PREVIOUS counts — and a customer check against a stale
     * denominator refuses a save that is actually fine. The form sends the
     * counts it just wrote; those win, and the sheet read is the fallback for
     * an acquisition row saved on its own.
     */
    const fresh = (k: string, fallback: number) => {
      const raw = String(values[k] ?? '').trim();
      return raw === '' ? fallback : num(values[k]);
    };

    for (const p of ['b2c', 'b2b', 'pm'] as const) {
      const spend = num(values[`${p}_spend`]);
      const customers = num(values[`${p}_customers`]);
      const catLeads = fresh(`${p}_leads_now`, num(lead[`${p}_total`]));
      const catValid = fresh(`${p}_valid_now`, num(lead[`${p}_valid`]));
      
      if (spend < 0) {
        throw new HttpError(400, `${p.toUpperCase()} spend cannot be negative.`);
      }
      if (customers < 0) {
        throw new HttpError(400, `${p.toUpperCase()} customers cannot be negative.`);
      }
      if (customers > catLeads && catLeads > 0) {
        throw new HttpError(400,
          `${p.toUpperCase()} has ${customers} customers against ${catLeads} leads for ${month}. ` +
          `A customer has to have been a lead first.`);
      }

      // Cost per lead, over VALID leads only. An unqualified lead cost money
      // to acquire but was never a prospect, so dividing by every lead
      // flatters the figure.
      out[`${p}_cpl`] = per(spend, catValid);
      out[`${p}_cac`] = per(spend, customers);
      out[`${p}_l2c`] = pct(customers, catLeads);

      totalSpend += spend;
      totalCustomers += customers;
    }

    const allLeads = fresh('leads_now', num(lead.total_leads));
    const allValid = fresh('valid_now', num(lead.total_valid));

    out.total_spend = String(Math.round(totalSpend));
    out.total_customers = String(totalCustomers);

    out.leads_at_entry = String(allLeads);
    out.valid_at_entry = String(allValid);

    out.cpl = per(totalSpend, allValid);
    out.cac = per(totalSpend, totalCustomers);
    out.l2c_rate = pct(totalCustomers, allLeads);

    out.entered_by = principal.email;
    return out;
  },
};

/** Sheet figures arrive with commas and stray spaces. */
const num = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(/[,\s₹]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * "YYYY-MM" for a month cell, however Sheets hands it back.
 *
 * Three shapes reach this, and the third is the one that bit:
 *
 *   "2026-02-01"  written by us, read back from a text-formatted cell
 *   "01/02/2026"  a locale string, if someone reformatted the column
 *   46054         a real date cell — readDataset asks for UNFORMATTED_VALUE,
 *                 so Sheets returns its own serial, not a string
 *
 * The serial is days since 1899-12-30. Without handling it, the acquisition
 * deriver could not find the lead row it had written moments earlier, and
 * reported the month as missing.
 *
 * Everything below reads the date in UTC. The serial converts to UTC midnight,
 * and a server behind UTC calling getMonth() on that lands on the previous
 * day — which for the first of the month is the previous month, silently
 * filing January's costs against December.
 */
const monthKey = (v: unknown): string => {
  const fromDate = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

  // Sheets serial. Bounded to a plausible range so a bare count in a
  // mistyped column cannot be read as a date.
  const asNum = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  if (Number.isFinite(asNum) && asNum > 20000 && asNum < 80000) {
    return fromDate(new Date(Math.round((asNum - 25569) * 86400000)));
  }

  const raw = String(v ?? '').trim();
  if (!raw) return '';

  const iso = /^(\d{4})-(\d{2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}`;

  // A bare run of digits is either a serial, already handled above, or junk.
  // Date.parse reads "916" as the year 916 and would hand back a confident
  // "916-01" for a lead count that landed in the wrong column.
  if (/^\d+$/.test(raw)) return '';

  const t = Date.parse(raw);
  return Number.isFinite(t) ? fromDate(new Date(t)) : '';
};

export async function derive(
  ds: DatasetDef,
  values: Row,
  ctx: { principal: Principal; tab: string },
): Promise<Row> {
  const fn = DERIVERS[ds.id];
  return fn ? fn(values, ctx) : values;
}
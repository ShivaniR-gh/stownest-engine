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

const DERIVERS: Record<string, Deriver> = {

  /**
   * A space reading stores only wh_code and occupied_space from the user.
   * Everything else is derived:
   *
   *  - wh_name / city / location / total_space are SNAPSHOT from the warehouse
   *    master at write time. Snapshotting rather than joining is deliberate:
   *    when a warehouse is expanded from 11,247 to 15,000 sqft in June, March's
   *    reading must keep showing 11,247. A live join would silently rewrite
   *    every past month's utilisation and reshape the trend chart.
   *
   *  - available_space and utilisation_pct are computed, never entered. The
   *    source sheet has rows where these disagree with the figures above them.
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
      entered_by:     principal.email,
    };
  },

  /**
   * The employee enters what they are looking at on the statement: what was
   * raised and what came in. The gap between the two is arithmetic, so the
   * server does it — a figure a person retypes is a figure that can disagree
   * with the two numbers above it, and the sheet already has months where it
   * does.
   *
   * Share in revenue is NOT derived. The historical sheet's share figures do
   * not reconcile against any denominator in the data, so computing one here
   * would silently replace the team's definition with a guess.
   */
  /**
   * Every figure the sheet computes, recomputed here. The employee enters the
   * month totals and the two transportation segments; storage is the remainder
   * and the gaps and shares are arithmetic.
   *
   * The browser sends these too, but a value the browser calculates is a value
   * the browser can be wrong about, so the server has the last word.
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
     * Entered value wins; the computed figure is only a fallback for a blank
     * field. Recomputing over what the team typed would let the percentage
     * contradict the amount printed beside it.
     */
    const entered = (key: string, fallback: number) => {
      const raw = String(values[key] ?? '').trim();
      return raw === '' ? fallback : num(values[key]);
    };

    /**
     * Gap % divides by Raised Invoice amount, matching the sheet's row 7
     * (=C6/C5*100). Checked against the columns that already hold values:
     * March 6.678613, April 7.426019, May 7.778137 all reproduce to six
     * decimals. Dividing by Collection Amount gives 5.10 / 6.54 / 6.36 for
     * those same months, which matches nothing in the sheet. Collection
     * Amount is collected against everything outstanding while Pending is
     * this month alone, so that denominator mixes two periods.
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
  /**
   * Acquisition cost.
   *
   * Spend is recorded once for the month, because that is the only way it can
   * be observed: the ad accounts report an account-level total and the
   * campaigns carry no line-of-business label. So the cost metrics here are
   * blended across all three categories, and there are no per-category ones.
   *
   * Lead-to-customer rate is the exception that survives — it divides
   * customers by leads and never touches spend, so it stays meaningful per
   * category and is the one place the three lines can still be compared.
   *
   * The lead counts are read at write time and snapshotted, not joined at read
   * time: if someone corrects March's leads in June, March's CPL as recorded
   * stays what CPL was understood to be when the month was closed. Same
   * reasoning as the warehouse readings snapshot.
   *
   * The lead row must already exist. Refusing rather than writing zeros is
   * deliberate: a CPL of Rs 0 renders as a real figure and nobody reading the
   * dashboard would know it was a placeholder.
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

    /** Blank rather than a misleading zero when the denominator is absent. */
    const per = (spend: number, denom: number) => (denom > 0 ? (spend / denom).toFixed(0) : '');
    const pct = (part: number, whole: number) => (whole > 0 ? ((part / whole) * 100).toFixed(1) : '');

    const totalSpend = num(values.total_spend);
    if (totalSpend < 0) throw new HttpError(400, 'Marketing spend cannot be negative.');

    const cat = (p: string) => {
      const customers = num(values[`${p}_customers`]);
      const total = num(lead[`${p}_total`]);

      if (customers > total && total > 0) {
        throw new HttpError(400,
          `${p.toUpperCase()} customers (${customers}) cannot exceed its ${total} leads for ${month}.`);
      }
      return { customers, l2c: pct(customers, total) };
    };

    const b2c = cat('b2c');
    const b2b = cat('b2b');
    const pm = cat('pm');

    const totalCustomers = b2c.customers + b2b.customers + pm.customers;
    const allLeads = num(lead.total_leads);
    const allValid = num(lead.total_valid);

    return {
      ...values,
      total_customers: String(totalCustomers),

      b2c_l2c: b2c.l2c, b2b_l2c: b2b.l2c, pm_l2c: pm.l2c,

      leads_at_entry: String(allLeads),
      valid_at_entry: String(allValid),

      cpl: per(totalSpend, allLeads),
      cpvl: per(totalSpend, allValid),
      cac: per(totalSpend, totalCustomers),
      l2c_rate: pct(totalCustomers, allLeads),

      entered_by: principal.email,
    };
  },
};

/** Sheet figures arrive with commas and stray spaces. */
const num = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(/[,\s₹]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * "YYYY-MM" for a month cell, however the sheet hands it back.
 *
 * The two marketing tabs are joined on this, and Sheets will return the same
 * month as an ISO string, a locale date or plain text depending on how the
 * cell was formatted. Comparing raw strings silently fails to match and the
 * acquisition row is then refused for a month that plainly exists.
 */
const monthKey = (v: unknown): string => {
  const raw = String(v ?? '').trim();
  if (!raw) return '';
  const iso = /^(\d{4})-(\d{2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export async function derive(
  ds: DatasetDef,
  values: Row,
  ctx: { principal: Principal; tab: string },
): Promise<Row> {
  const fn = DERIVERS[ds.id];
  return fn ? fn(values, ctx) : values;
}

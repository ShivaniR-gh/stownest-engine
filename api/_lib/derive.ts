import type { DatasetDef, Row } from '../../src/config/types.js';
import type { Principal } from '../../src/lib/permissions/policy.js';
import { HttpError } from './env.js';
import { readDataset } from './sheets.js';
import { getDatasetDef } from './registry.js';

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


/**
 * Operations monthly report — deliveries, pick-ups, inter-state.
 *
 * Three blocks of the same shape: figures entered per city, roll-ups computed.
 * Every roll-up below was checked against the circulated report and reproduces
 * it exactly, which is why they are computed rather than typed:
 *   Bangalore  133 + 43 = 176 full,  46 + 28 = 74 partial,  176 + 74 = 250
 *   Bangalore  186 + 7  = 193 new,   16 + 2  = 18 add on,   193 + 18 = 211
 * The column totals reconcile too — 244 / 105 / 92 / 55 and 393 / 12 / 50 / 3.
 *
 * The browser computes the same figures for its live preview, but a value the
 * browser calculates is a value the browser can be wrong about, so these are
 * what actually reach the sheet.
 */
const OPS_CITY_KEYS = ['blr', 'hyd', 'che', 'pun', 'mum', 'del', 'kol'];

/** Sums the entered fields across cities, refusing negatives, and hands back
 *  one total per field. Shared by all three city blocks. */
function opsTotals(values: Row, fields: readonly string[], label: string) {
  const totals: Record<string, number> = Object.fromEntries(fields.map(f => [f, 0]));
  for (const c of OPS_CITY_KEYS) {
    for (const f of fields) {
      const v = num(values[`${c}_${f}`]);
      if (v < 0) {
        throw new HttpError(400,
          `${label} figures for ${c.toUpperCase()} cannot be negative.`);
      }
      totals[f] += v;
    }
  }
  return totals;
}

const opsDeliveriesDerive: Deriver = async (values, { principal }) => {
  const entered = ['sn_all', 'sn_part', 'cust_all', 'cust_part'] as const;
  const out: Row = { ...values };

  for (const c of OPS_CITY_KEYS) {
    const full = num(values[`${c}_sn_all`]) + num(values[`${c}_cust_all`]);
    const partial = num(values[`${c}_sn_part`]) + num(values[`${c}_cust_part`]);
    out[`${c}_full`] = String(full);
    out[`${c}_partial`] = String(partial);
    out[`${c}_total`] = String(full + partial);
  }

  const t = opsTotals(values, entered, 'Delivery');
  const full = t.sn_all + t.cust_all;
  const partial = t.sn_part + t.cust_part;
  const all = full + partial;

  return {
    ...out,
    tot_sn_all: String(t.sn_all),
    tot_sn_part: String(t.sn_part),
    tot_cust_all: String(t.cust_all),
    tot_cust_part: String(t.cust_part),
    tot_full: String(full),
    tot_partial: String(partial),
    tot_total: String(all),
    // Blank rather than a misleading zero when nothing was delivered: a share
    // of "0%" reads as a bad month, a blank reads as an empty one.
    full_pct: all > 0 ? ((full / all) * 100).toFixed(1) : '',
    partial_pct: all > 0 ? ((partial / all) * 100).toFixed(1) : '',
    entered_by: principal.email,
  };
};

const opsPickupsDerive: Deriver = async (values, { principal }) => {
  const entered = ['sn', 'cust', 'sn_addon', 'cust_addon'] as const;
  const out: Row = { ...values };

  for (const c of OPS_CITY_KEYS) {
    const fresh = num(values[`${c}_sn`]) + num(values[`${c}_cust`]);
    const addon = num(values[`${c}_sn_addon`]) + num(values[`${c}_cust_addon`]);
    out[`${c}_new`] = String(fresh);
    out[`${c}_addon`] = String(addon);
    out[`${c}_total`] = String(fresh + addon);
  }

  const t = opsTotals(values, entered, 'Pick-up');
  const fresh = t.sn + t.cust;
  const addon = t.sn_addon + t.cust_addon;

  return {
    ...out,
    tot_sn: String(t.sn),
    tot_cust: String(t.cust),
    tot_sn_addon: String(t.sn_addon),
    tot_cust_addon: String(t.cust_addon),
    tot_addon: String(addon),
    tot_new: String(fresh),
    tot_total: String(fresh + addon),
    entered_by: principal.email,
  };
};

const opsMovingDerive: Deriver = async (values, { principal }) => {
  const t = opsTotals(values, ['del_is', 'pick_is', 'pick_local'], 'Moving');
  return {
    ...values,
    tot_del_is: String(t.del_is),
    tot_pick_is: String(t.pick_is),
    tot_pick_local: String(t.pick_local),
    entered_by: principal.email,
  };
};

const DERIVERS: Record<string, Deriver> = {

  b2b_occupancy: async (values, { principal }) => {
    const txnC = num(values.txn_clients);
    const nonC = num(values.nontxn_clients);
    const docC = num(values.doc_clients);
    const txnS = num(values.txn_sqft);
    const nonS = num(values.nontxn_sqft);
    const mk = monthKey(values.month);
    const city = String(values.city ?? '').trim();
    return {
      ...values,
      row_key: `${mk}|${city}`,
      active_clients: String(txnC + nonC + docC),
      occupied_sqft: String(txnS + nonS),
      entered_by: principal.email,
    };
  },

  b2b_moves: async (values, { principal }) => {
    const inn = num(values.inward);
    const out = num(values.outward);
    const rev = num(values.txn_revenue);
    const txns = inn + out;
    const mk = monthKey(values.month);
    const city = String(values.city ?? '').trim();
    return {
      ...values,
      row_key: `${mk}|${city}`,
      total_txns: String(txns),
      rev_per_move: txns > 0 ? String(rev / txns) : '',
      entered_by: principal.email,
    };
  },

  b2b_movement: async (values, { principal }) => {
    const mk = monthKey(values.month);
    const city = String(values.city ?? '').trim();
    const name = String(values.client_name ?? '').trim();
    return {
      ...values,
      row_key: `${mk}|${city}|${name}`,
      client_name: name,
      entered_by: principal.email,
    };
  },

  b2b_sales: async (values, { principal }) => {
    const txn = num(values.txn_leads);
    const doc = num(values.doc_leads);
    const valid = Math.max(0, txn + doc);
    const won = num(values.closed_won);
    const sqft = num(values.sqft_won);
    const rev = num(values.est_rev);
    const mk = monthKey(values.month);
    const city = String(values.city ?? '').trim();
    const sp = String(values.salesperson ?? '').trim();
    const svc = String(values.service ?? '').trim();
    const src = String(values.lead_source ?? '').trim();
    return {
      ...values,
      row_key: `${mk}|${city}|${svc}|${sp}|${src}`,
      valid: String(valid),
      conversion: valid > 0 ? String((won / valid) * 100) : '',
      avg_sqft: won > 0 ? String(sqft / won) : '',
      avg_price: sqft > 0 ? String(rev / sqft) : '',
      entered_by: principal.email,
    };
  },

  b2b_revenue: async (values, { principal }) => {
    const rental = num(values.rental_rev);
    const txn = num(values.txn_rev);
    const logi = num(values.logistics_rev);
    const mk = monthKey(values.month);
    const city = String(values.city ?? '').trim();
    return {
      ...values,
      row_key: `${mk}|${city}`,
      total_rev: String(rental + txn + logi),
      entered_by: principal.email,
    };
  },

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

    return {
      ...values,
      wh_name:        String(wh.wh_name ?? ''),
      city:           String(wh.city ?? ''),
      location:       String(wh.location ?? ''),
      total_space:    String(total),
      occupied_space: String(occupied),
      available_space: String(total - occupied),
      utilisation_pct: total > 0 ? (occupied / total * 100).toFixed(1) : '0',
      avg_space: totalCust > 0 ? (occupied / totalCust).toFixed(0) : '',
      recorded_on:    String(values.recorded_on ?? new Date().toISOString().slice(0, 10)),
      total_customers: String(totalCust),
      new_customers: String(newCust),
      churned_customers: String(churned),
      /* Opening balance, not the closing total: whoever joined this month was
         never at risk of leaving it. Closing − joined + left is what the month
         started with, and should equal last month's closing total. */
      churn_pct: (() => {
        const opening = Math.max(0, totalCust - newCust + churned);
        return opening > 0 ? ((churned / opening) * 100).toFixed(1) : '';
      })(),
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

  /** Operations monthly report — one deriver per block of the report. */
  ops_deliveries: opsDeliveriesDerive,
  ops_pickups: opsPickupsDerive,
  ops_moving: opsMovingDerive,

  /**
   * Tickets. Two figures and their sum — small enough that the arithmetic is
   * obvious, which is exactly why it should not be typed twice.
   */
  ops_tickets: async (values, { principal }) => {
    const visits = num(values.warehouse_visit);
    const photos = num(values.photo_request);
    if (visits < 0 || photos < 0) {
      throw new HttpError(400, 'Ticket counts cannot be negative.');
    }
    return {
      ...values,
      warehouse_visit: String(visits),
      photo_request: String(photos),
      tot_tickets: String(visits + photos),
      entered_by: principal.email,
    };
  },

  finance_pnl: async (values, { principal }) => {
    const g = (k: string) => num(values[k]);
    const b2c = g('b2c_storage') + g('b2c_transport') + g('b2c_packing');
    const b2b = g('b2b_storage') + g('b2b_transport');
    const rev = b2c + b2b;
    const cogs = g('cogs_wh_rent') + g('cogs_logistics') + g('cogs_labour')
      + g('cogs_damages') + g('cogs_packing');
    const gp = rev - cogs;
    const indirect = g('exp_salary') + g('exp_marketing') + g('exp_intermediary')
      + g('exp_other') + g('exp_emi');
    const pbt = gp - indirect;
    const tax = g('tax_gst');
    return {
      ...values,
      b2c_rev: String(b2c),
      b2b_rev: String(b2b),
      tot_rev: String(rev),
      tot_cogs: String(cogs),
      gross_profit: String(gp),
      tot_indirect: String(indirect),
      net_profit: String(pbt),
      tax_gst: String(tax),
      profit_after_tax: String(pbt - tax),
      entered_by: principal.email,
    };
  },

  ct_city_income: async (values, { principal }) => {
    const cities = ['blr', 'hyd', 'che', 'pun', 'mum', 'del', 'kol'];
    const out: Row = { ...values };
    let clients = 0, rental = 0, logistic = 0;
    for (const c of cities) {
      const cl = num(values[`${c}_clients`]);
      const rn = num(values[`${c}_rental`]);
      const lg = num(values[`${c}_logistic`]);
      out[`${c}_clients`] = String(cl);
      out[`${c}_rental`] = String(rn);
      out[`${c}_logistic`] = String(lg);
      clients += cl; rental += rn; logistic += lg;
    }
    out.tot_clients = String(clients);
    out.tot_rental = String(rental);
    out.tot_logistic = String(logistic);
    out.tot_income = String(rental + logistic);
    out.entered_by = principal.email;
    return out;
  },

  ct_rental_trends: async (values, { principal }) => {
    const pkR = num(values.pk_rental);
    const pkC = num(values.pk_count);
    const dlR = num(values.dl_rental);
    const dlC = num(values.dl_count);
    return {
      ...values,
      pk_rental: String(pkR), pk_count: String(pkC),
      dl_rental: String(dlR), dl_count: String(dlC),
      rental_diff: String(pkR - dlR),
      count_diff: String(pkC - dlC),
      entered_by: principal.email,
    };
  },

  ct_city_gap: async (values, { principal }) => {
    const cities = ['blr', 'hyd', 'che', 'pun', 'mum', 'del', 'kol'];
    const out: Row = { ...values };
    let totP = 0, totD = 0;
    for (const c of cities) {
      const p = num(values[`${c}_pickups`]);
      const d = num(values[`${c}_deliveries`]);
      out[`${c}_pickups`] = String(p);
      out[`${c}_deliveries`] = String(d);
      out[`${c}_diff`] = String(p - d);
      out[`${c}_pct`] = d > 0 ? String(((p - d) / d) * 100) : '0';
      totP += p; totD += d;
    }
    out.tot_pickups = String(totP);
    out.tot_deliveries = String(totD);
    out.tot_diff = String(totP - totD);
    out.tot_pct = totD > 0 ? String(((totP - totD) / totD) * 100) : '0';
    out.entered_by = principal.email;
    return out;
  },

  ct_interstate: async (values, { principal }) => {
    const pkDone = num(values.pk_done);
    const pkTr = num(values.pk_transit);
    const dlDone = num(values.dl_done);
    const dlTr = num(values.dl_transit);
    return {
      ...values,
      pk_done: String(pkDone), pk_transit: String(pkTr), pk_total: String(pkDone + pkTr),
      dl_done: String(dlDone), dl_transit: String(dlTr), dl_total: String(dlDone + dlTr),
      entered_by: principal.email,
    };
  },

  ct_reviews: async (values, { principal }) => {
    const cities = ['blr', 'hyd', 'che', 'pun', 'mum', 'del', 'kol'];
    const suffixes = ['pk_req', 'pk_rev', 'pk_neg', 'dl_req', 'dl_rev', 'comm', 'price', 'dmg', 'star'];
    const out: Row = { ...values };
    const tot: Record<string, number> = {};
    for (const s of suffixes) tot[s] = 0;
    for (const c of cities) {
      for (const s of suffixes) {
        const v = num(values[`${c}_${s}`]);
        out[`${c}_${s}`] = String(v);
        tot[s] += v;
      }
    }
    out.tot_pk_req = String(tot.pk_req);
    out.tot_pk_rev = String(tot.pk_rev);
    out.tot_pk_neg = String(tot.pk_neg);
    out.tot_dl_req = String(tot.dl_req);
    out.tot_dl_rev = String(tot.dl_rev);
    out.entered_by = principal.email;
    return out;
  },

  ct_tickets: async (values, { principal }) => {
    const dmgE = num(values.dmg_exp);
    const dmgT = num(values.dmg_tix);
    const missE = num(values.miss_exp);
    const missT = num(values.miss_tix);
    const inv = num(values.inv_queries);
    const esc = num(values.escalations);
    const vis = num(values.wh_visits);
    const photo = num(values.photo_video);
    return {
      ...values,
      dmg_exp: String(dmgE), dmg_tix: String(dmgT),
      miss_exp: String(missE), miss_tix: String(missT),
      exp_total: String(dmgE + missE),
      tix_dmg_total: String(dmgT + missT),
      inv_queries: String(inv), escalations: String(esc),
      wh_visits: String(vis), photo_video: String(photo),
      other_total: String(inv + esc + vis + photo),
      entered_by: principal.email,
    };
  },

  ct_delivery_econ: async (values, { principal }) => {
    const tot = num(values.tot_del);
    const cust = num(values.by_cust);
    const sn = num(values.by_sn);
    const items = num(values.items);
    const rev = num(values.revenue);
    return {
      ...values,
      tot_del: String(tot), by_cust: String(cust), by_sn: String(sn),
      items: String(items), revenue: String(rev),
      conv_rate: tot > 0 ? String((sn / tot) * 100) : '0',
      earn_per: sn > 0 ? String(rev / sn) : '0',
      entered_by: principal.email,
    };
  },

  ct_calls: async (values, { principal }) => {
    const callKeys = ['cq_new','cq_rm','cq_enq','cq_pd','cq_biz','cq_inv_ct','cq_inv_ac','cq_new_del','cq_rep_del','cq_dmg','cq_rep_dmg','cq_other','cq_invalid'];
    const ikKeys = ['ik_new','ik_enq','ik_new_del','ik_other','ik_invalid'];
    const out: Row = { ...values };
    let cq = 0, ik = 0;
    for (const k of callKeys) { const v = num(values[k]); out[k] = String(v); cq += v; }
    for (const k of ikKeys) { const v = num(values[k]); out[k] = String(v); ik += v; }
    out.cq_miss = String(num(values.cq_miss));
    out.cq_total = String(cq);
    out.ik_total = String(ik);
    out.entered_by = principal.email;
    return out;
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
   *  CPL      = spend / valid leads
   *  CAC      = spend / customers
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
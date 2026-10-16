/**
 * Client-side ESTIMATE preview of the SPEC §4 cost engine.
 * The backend is authoritative; this only mirrors the estimate half so the
 * "Yangi xarid" form can show per-unit overhead while typing.
 *
 *   price_usd      = price_aed / rate
 *   perevod        = price_usd × perevod_pct
 *   line estimates = cargo, imei, airport_road, inspector, bu, packaging, sim, rastamojka (per unit)
 *   batch share    = Σ batch-level estimate totals / Σ qty of ALL lines (own + client)
 *   unit_cost_est  = price_usd + Σ line estimates + batch share
 *   overhead_est   = unit_cost_est − price_usd
 */

export interface PreviewLineInput {
  qty: number;
  price_aed: number;
  rate: number;
  perevod_pct: number;
  cargo: number;
  imei: number;
  airport_road: number;
  inspector: number;
  bu: number;
  packaging: number;
  sim: number;
  rastamojka: number;
  /** Client lines only (fraction). */
  service_pct: number | null;
}

export interface PreviewLineResult {
  price_usd: number;
  perevod: number;
  line_overhead: number;
  batch_share: number;
  overhead_est: number;
  unit_cost_est: number;
  total_cost_est: number;
  /** Client lines: unit_cost_est + price_usd × service_pct. */
  charge_per_unit: number | null;
}

export interface PreviewBatchResult {
  lines: PreviewLineResult[];
  total_qty: number;
  batch_total: number;
  batch_share_per_unit: number;
  price_usd_total: number;
  cost_est_total: number;
  overhead_per_unit_avg: number;
}

export function previewBatch(lines: PreviewLineInput[], batchEstimateTotal: number): PreviewBatchResult {
  const totalQty = lines.reduce((sum, l) => sum + (l.qty > 0 ? l.qty : 0), 0);
  const batchShare = totalQty > 0 ? batchEstimateTotal / totalQty : 0;

  let priceTotal = 0;
  let costTotal = 0;
  const results = lines.map((l): PreviewLineResult => {
    const priceUsd = l.rate > 0 ? l.price_aed / l.rate : 0;
    const perevod = priceUsd * l.perevod_pct;
    const lineOverhead =
      perevod + l.cargo + l.imei + l.airport_road + l.inspector + l.bu + l.packaging + l.sim + l.rastamojka;
    const overhead = lineOverhead + batchShare;
    const unitCost = priceUsd + overhead;
    const qty = l.qty > 0 ? l.qty : 0;
    priceTotal += priceUsd * qty;
    costTotal += unitCost * qty;
    return {
      price_usd: priceUsd,
      perevod,
      line_overhead: lineOverhead,
      batch_share: batchShare,
      overhead_est: overhead,
      unit_cost_est: unitCost,
      total_cost_est: unitCost * qty,
      charge_per_unit: l.service_pct !== null ? unitCost + priceUsd * l.service_pct : null,
    };
  });

  return {
    lines: results,
    total_qty: totalQty,
    batch_total: batchEstimateTotal,
    batch_share_per_unit: batchShare,
    price_usd_total: priceTotal,
    cost_est_total: costTotal,
    overhead_per_unit_avg: totalQty > 0 ? (costTotal - priceTotal) / totalQty : 0,
  };
}

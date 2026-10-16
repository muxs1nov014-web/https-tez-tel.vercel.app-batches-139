import { useMemo } from 'react';
import type { BatchDetail } from '../../api/batches';
import { Card } from '../../components/ui/Card';
import { ListRow, ListSection } from '../../components/ui/List';
import { fmtQty, fmtUsd, fmtUsdUp, toNum } from '../../lib/format';

/**
 * Landed unit cost per model of a saved batch, like the card on the new-purchase form: lines of one model are
 * merged, in the order the models first appear. Uses the effective cost, so real expenses show once entered.
 * Shown as `qty dona × unit` in whole dollars, cents rounded up.
 */
export function ModelCostCard({ batch }: { batch: BatchDetail }) {
  const rows = useMemo(() => {
    const byProduct = new Map<number, { productId: number; name: string; qty: number; total: number; extra: number }>();
    for (const line of batch.lines) {
      const row = byProduct.get(line.product.id) ?? { productId: line.product.id, name: line.product.name, qty: 0, total: 0, extra: 0 };
      row.qty += line.qty;
      row.total += toNum(line.unit_cost) * line.qty;
      row.extra += toNum(line.overhead) * line.qty;
      byProduct.set(line.product.id, row);
    }
    return [...byProduct.values()].map((r) => ({
      ...r,
      unit: r.qty > 0 ? r.total / r.qty : 0,
      overhead: r.qty > 0 ? r.extra / r.qty : 0,
    }));
  }, [batch.lines]);

  if (rows.length === 0) return null;
  const hasActuals = batch.categories.some((c) => c.actual_total !== null);
  const note = hasActuals
    ? "Bitta telefonga tushgan tannarx (real xarajatlar bilan): narx + ustama + partiya xarajati ulushi."
    : "Bitta telefonga tushgan taxminiy tannarx: narx + ustama + partiya xarajati ulushi.";

  return (
    <>
      <ListSection className="pt-2 md:hidden" header="Model bo'yicha tannarx" footer={note}>
        {rows.map((m) => (
          <ListRow
            key={m.productId}
            title={<span className="line-clamp-2 whitespace-normal">{m.name}</span>}
            value={
              <>
                <span className="font-normal text-slate-500">{fmtQty(m.qty)} dona × </span>
                {fmtUsdUp(m.unit)}
                <span className="block text-xs font-normal text-slate-500">xarajat +{fmtUsd(m.overhead, { symbol: true })} / dona</span>
              </>
            }
            valueStrong
          />
        ))}
      </ListSection>
      <Card className="hidden max-w-xl md:block" title="Model bo'yicha tannarx" subtitle={note}>
        <div className="divide-y divide-slate-100 px-4">
          {rows.map((m) => (
            <div key={m.productId} className="flex items-baseline justify-between gap-3 py-2.5">
              <div className="min-w-0 truncate font-medium text-slate-900">{m.name}</div>
              <div className="shrink-0 text-right text-[17px] tabular-nums">
                <span className="mr-3 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                  xarajat +{fmtUsd(m.overhead, { symbol: true })}
                </span>
                <span className="text-slate-500">{fmtQty(m.qty)} dona × </span>
                <span className="font-semibold text-slate-900">{fmtUsdUp(m.unit)}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

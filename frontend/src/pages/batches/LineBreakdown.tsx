import type { BatchCategory, LineOut } from '../../api/batches';
import { Badge } from '../../components/ui/Badge';
import { LEVEL_LABELS } from '../../lib/categories';
import { fmtAed, fmtPct, fmtQty, fmtRate, fmtSignedUsd, fmtUsd, signClass, toNum } from '../../lib/format';

interface LineBreakdownProps {
  line: LineOut;
  categories: BatchCategory[];
}

/** Numbers behind the breakdown, shared by the desktop table and the iPhone sheet (`LineSheet`). */
export function lineBreakdown(line: LineOut, categories: BatchCategory[]) {
  const rows = categories.map((c) => {
    const pair = line.per_unit[c.code];
    const estimate = toNum(pair?.estimate);
    const effective = toNum(pair?.effective);
    return { category: c, estimate, effective, diff: effective - estimate };
  });
  const visible = rows.filter((r) => Math.abs(r.estimate) > 0.00005 || Math.abs(r.effective) > 0.00005);
  const hiddenCount = rows.length - visible.length;

  const priceUsd = toNum(line.price_usd);
  const serviceFee = line.client && line.service_pct !== null ? priceUsd * toNum(line.service_pct) : null;
  const charge = serviceFee !== null ? toNum(line.unit_cost_est) + serviceFee : null;
  const margin = charge !== null ? (charge - toNum(line.unit_cost)) * line.qty : null;
  return { visible, hiddenCount, priceUsd, serviceFee, charge, margin };
}

/** Per-category per-unit costs of one line: estimate vs effective (from `per_unit`). */
export function LineBreakdown({ line, categories }: LineBreakdownProps) {
  const { visible, hiddenCount, priceUsd, serviceFee, charge, margin } = lineBreakdown(line, categories);

  return (
    <div className="grid gap-4 px-2 py-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <table className="tbl rounded-xl bg-surface ring-1 ring-slate-200">
        <thead>
          <tr>
            <th>Kategoriya</th>
            <th>Daraja</th>
            <th className="num">Taxminiy / dona</th>
            <th className="num">Amaldagi / dona</th>
            <th className="num">Farq / dona</th>
            <th className="num">Amaldagi × {fmtQty(line.qty)}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="font-medium">Narx</td>
            <td className="text-xs text-slate-500">
              {fmtAed(line.price_aed, { symbol: true })} ÷ {fmtRate(line.rate)}
            </td>
            <td className="num">{fmtUsd(line.price_usd)}</td>
            <td className="num">{fmtUsd(line.price_usd)}</td>
            <td className="num text-slate-400">—</td>
            <td className="num">{fmtUsd(priceUsd * line.qty)}</td>
          </tr>
          {visible.map((r) => (
            <tr key={r.category.code}>
              <td>
                {r.category.label}
                {r.category.code === 'perevod' && (
                  <span className="ml-1 text-xs text-slate-500">({fmtPct(line.estimates.perevod_pct)})</span>
                )}
              </td>
              <td className="text-xs text-slate-500">{LEVEL_LABELS[r.category.level]}</td>
              <td className="num">{fmtUsd(r.estimate)}</td>
              <td className="num font-medium">{fmtUsd(r.effective)}</td>
              <td className={`num ${signClass(r.diff, true)}`}>{fmtSignedUsd(r.diff)}</td>
              <td className="num">{fmtUsd(r.effective * line.qty)}</td>
            </tr>
          ))}
          {hiddenCount > 0 && (
            <tr>
              <td colSpan={6} className="text-xs text-slate-400">
                Yana {hiddenCount} ta kategoriya bo'yicha xarajat yo'q (0).
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>Ustama / dona</td>
            <td className="num">{fmtUsd(line.overhead_est)}</td>
            <td className="num">{fmtUsd(line.overhead)}</td>
            <td className={`num ${signClass(toNum(line.overhead) - toNum(line.overhead_est), true)}`}>
              {fmtSignedUsd(toNum(line.overhead) - toNum(line.overhead_est))}
            </td>
            <td className="num">{fmtUsd(toNum(line.overhead) * line.qty)}</td>
          </tr>
          <tr>
            <td colSpan={2}>Tannarx / dona</td>
            <td className="num">{fmtUsd(line.unit_cost_est)}</td>
            <td className="num">{fmtUsd(line.unit_cost)}</td>
            <td className={`num ${signClass(toNum(line.unit_cost) - toNum(line.unit_cost_est), true)}`}>
              {fmtSignedUsd(toNum(line.unit_cost) - toNum(line.unit_cost_est))}
            </td>
            <td className="num">{fmtUsd(toNum(line.unit_cost) * line.qty)}</td>
          </tr>
        </tfoot>
      </table>

      <div className="space-y-3 text-[13px]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl bg-surface p-3 ring-1 ring-slate-200">
          <dt className="text-slate-500">Kanal</dt>
          <dd>{line.channel?.name ?? '—'}</dd>
          {line.client ? (
            <>
              <dt className="text-slate-500">Mijoz</dt>
              <dd>
                <Badge tone="primary">{line.client.name}</Badge>
              </dd>
            </>
          ) : (
            <>
              <dt className="text-slate-500">Sotilgan</dt>
              <dd className="tabular-nums">{fmtQty(line.sold_qty)} dona</dd>
              <dt className="text-slate-500">Hisobdan chiqarilgan</dt>
              <dd className="tabular-nums">{fmtQty(line.adjusted_qty)} dona</dd>
              <dt className="text-slate-500">Mijozlarda</dt>
              <dd className="tabular-nums">{fmtQty(line.consigned_qty ?? 0)} dona</dd>
              <dt className="text-slate-500">Qoldiq</dt>
              <dd className="font-medium tabular-nums">{fmtQty(line.remaining_qty)} dona</dd>
            </>
          )}
          {line.raw_name && (
            <>
              <dt className="text-slate-500">Excel nomi</dt>
              <dd className="font-mono text-xs">{line.raw_name}</dd>
            </>
          )}
          {line.note && (
            <>
              <dt className="text-slate-500">Izoh</dt>
              <dd>{line.note}</dd>
            </>
          )}
        </dl>

        {line.client && serviceFee !== null && charge !== null && margin !== null && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl bg-primary-50/60 p-3 ring-1 ring-primary-100">
            <dt className="text-slate-600">Xizmat haqi</dt>
            <dd className="tabular-nums">
              {fmtPct(line.service_pct)} = {fmtUsd(serviceFee, { symbol: true })} / dona
            </dd>
            <dt className="text-slate-600">Mijozga hisob</dt>
            <dd className="tabular-nums">{fmtUsd(charge, { symbol: true })} / dona</dd>
            <dt className="text-slate-600">Marja</dt>
            <dd className={`font-semibold tabular-nums ${signClass(margin)}`}>{fmtUsd(margin, { symbol: true })}</dd>
          </dl>
        )}
      </div>
    </div>
  );
}

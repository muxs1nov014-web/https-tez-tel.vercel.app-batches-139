import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getClientsReport, reportKeys, type ClientServiceRow } from '../../api/reports';
import { Card, TableWrap } from '../../components/ui/Card';
import { Combobox } from '../../components/ui/Combobox';
import { DateRangeFilter } from '../../components/ui/DateRangeFilter';
import { ListRow, ListSection } from '../../components/ui/List';
import { EmptyState, LoadingState, QueryView } from '../../components/ui/States';
import { StatCard } from '../../components/ui/StatCard';
import { fmtDate, fmtPct, fmtQty, fmtUsd, signClass, toNum } from '../../lib/format';
import { useCustomerList } from '../../lib/queries';
import { RangeRows } from './FormRows';
import { toApiRange, type RangeProps } from './rangeParams';

const TITLE = 'Mijozlar uchun import xizmati';
const SUBTITLE = 'Mijozga hisob = taxminiy tannarx + xizmat haqi. Marja = (hisob − amaldagi tannarx) × soni.';
const EMPTY = (
  <EmptyState
    title="Mijozlar uchun xarid yo'q"
    description="Xarid qatorida «Mijoz uchun» belgilansa, u shu hisobotda chiqadi."
  />
);

function totalsOf(rows: ClientServiceRow[]) {
  return rows.reduce(
    (acc, r) => ({
      qty: acc.qty + toNum(r.qty),
      charge: acc.charge + toNum(r.charge_total),
      cost: acc.cost + toNum(r.cost_total),
      margin: acc.margin + toNum(r.margin),
    }),
    { qty: 0, charge: 0, cost: 0, margin: 0 },
  );
}

/** iPhone: totals as widgets, then one row per client purchase line (charge on the right, margin under it). */
function ClientsList({ rows }: { rows: ClientServiceRow[] }) {
  const t = totalsOf(rows);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Hisob jami"
          value={fmtUsd(t.charge, { symbol: true })}
          sub={`Tannarx ${fmtUsd(t.cost, { symbol: true })}`}
        />
        <StatCard
          label="Marja"
          value={fmtUsd(t.margin, { symbol: true })}
          valueClassName={signClass(t.margin)}
          sub={t.charge !== 0 ? `${fmtPct(t.margin / t.charge, 1)} · ${fmtQty(t.qty)} dona` : `${fmtQty(t.qty)} dona`}
        />
      </div>
      <ListSection header={TITLE} footer={SUBTITLE} className="pt-2">
        {rows.map((r, i) => (
          <ListRow
            key={i}
            title={r.customer.name}
            subtitle={
              <>
                <span className="block truncate">{r.product.name}</span>
                <span className="block truncate">
                  Partiya {fmtDate(r.batch_date)} · {fmtQty(r.qty)} dona
                </span>
                <span className="block truncate text-slate-400">
                  narx {fmtUsd(r.price_usd)} · taxm. tannarx {fmtUsd(r.unit_cost_est)}
                </span>
                <span className="block truncate text-slate-400">
                  xizmat {fmtUsd(r.service_fee_per_unit)} · hisob {fmtUsd(r.charge_per_unit)} / dona
                </span>
              </>
            }
            value={fmtUsd(r.charge_total, { symbol: true })}
            valueStrong
            valueSub={<span className={signClass(r.margin)}>marja {fmtUsd(r.margin)}</span>}
          />
        ))}
      </ListSection>
    </div>
  );
}

export function ClientsReport({ range, onRangeChange, lead }: RangeProps) {
  const [customerId, setCustomerId] = useState<number | null>(null);
  const clients = useCustomerList({ kind: 'client' });
  const apiRange = useMemo(() => toApiRange(range), [range]);
  const query = useQuery({
    queryKey: reportKeys.clients(apiRange, customerId),
    queryFn: () => getClientsReport(apiRange, customerId),
  });
  const clientOptions = (clients.data ?? []).map((c) => ({ id: c.id, label: c.name }));

  return (
    <>
      <div className="space-y-4 md:hidden">
        <ListSection>
          {lead}
          <RangeRows value={range} onChange={onRangeChange} />
        </ListSection>
        <Combobox
          className="w-full"
          options={clientOptions}
          value={customerId}
          onChange={setCustomerId}
          loading={clients.isPending}
          clearable
          placeholder="Barcha mijozlar"
        />
        <QueryView query={query} isEmpty={(rows) => rows.length === 0} loading={<LoadingState />} empty={EMPTY}>
          {(rows) => <ClientsList rows={rows} />}
        </QueryView>
      </div>
      <Card
        className="hidden md:block"
        title={TITLE}
        subtitle={SUBTITLE}
        actions={
          <>
            <Combobox
              className="w-56"
              options={clientOptions}
              value={customerId}
              onChange={setCustomerId}
              loading={clients.isPending}
              clearable
              placeholder="Barcha mijozlar"
            />
            <DateRangeFilter value={range} onChange={onRangeChange} />
          </>
        }
      >
        <QueryView
          query={query}
          isEmpty={(rows) => rows.length === 0}
          empty={EMPTY}
        >
          {(rows) => {
            const t = totalsOf(rows);
            return (
              <TableWrap>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Mijoz</th>
                      <th>Partiya</th>
                      <th>Mahsulot</th>
                      <th className="num">Soni</th>
                      <th className="num">Narx ($)</th>
                      <th className="num">Taxm. tannarx ($)</th>
                      <th className="num">Xizmat / dona ($)</th>
                      <th className="num">Hisob / dona ($)</th>
                      <th className="num">Hisob jami ($)</th>
                      <th className="num">Tannarx jami ($)</th>
                      <th className="num">Marja ($)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td className="font-medium">{r.customer.name}</td>
                        <td className="whitespace-nowrap">{fmtDate(r.batch_date)}</td>
                        <td>{r.product.name}</td>
                        <td className="num">{fmtQty(r.qty)}</td>
                        <td className="num">{fmtUsd(r.price_usd)}</td>
                        <td className="num text-slate-500">{fmtUsd(r.unit_cost_est)}</td>
                        <td className="num">{fmtUsd(r.service_fee_per_unit)}</td>
                        <td className="num">{fmtUsd(r.charge_per_unit)}</td>
                        <td className="num font-medium">{fmtUsd(r.charge_total)}</td>
                        <td className="num text-slate-500">{fmtUsd(r.cost_total)}</td>
                        <td className={`num font-semibold ${signClass(r.margin)}`}>{fmtUsd(r.margin)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>Jami</td>
                      <td className="num">{fmtQty(t.qty)}</td>
                      <td colSpan={4} />
                      <td className="num">{fmtUsd(t.charge)}</td>
                      <td className="num">{fmtUsd(t.cost)}</td>
                      <td className={`num ${signClass(t.margin)}`}>
                        {fmtUsd(t.margin)}
                        {t.charge !== 0 && (
                          <span className="ml-1 text-xs font-normal text-slate-500">({fmtPct(t.margin / t.charge, 1)})</span>
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </TableWrap>
            );
          }}
        </QueryView>
      </Card>
    </>
  );
}

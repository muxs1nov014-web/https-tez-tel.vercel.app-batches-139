import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { batchKeys, listBatches, type BatchSummary } from '../../api/batches';
import { Can } from '../../components/Can';
import { Badge } from '../../components/ui/Badge';
import { ButtonLink } from '../../components/ui/Button';
import { Card, TableWrap } from '../../components/ui/Card';
import { DateRangeFilter } from '../../components/ui/DateRangeFilter';
import { PlusIcon } from '../../components/ui/icons';
import { ListRow, ListSection } from '../../components/ui/List';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, LoadingState, QueryView } from '../../components/ui/States';
import type { DateRangeValue } from '../../lib/dates';
import { fmtDate, fmtQty, fmtUsd, toNum } from '../../lib/format';
import { CompactRangeFilter } from './CompactRangeFilter';

const SUBTITLE =
  'Har bir xarid sanasi — alohida partiya. Tannarx taxminiy xarajatlardan, real xarajatlar kiritilgach realdan hisoblanadi.';

function totals(rows: BatchSummary[]) {
  return rows.reduce(
    (acc, r) => ({
      qty: acc.qty + toNum(r.total_qty),
      own: acc.own + toNum(r.own_qty),
      client: acc.client + toNum(r.client_qty),
      price: acc.price + toNum(r.price_usd_total),
      costEst: acc.costEst + toNum(r.cost_est_total),
      cost: acc.cost + toNum(r.cost_total),
    }),
    { qty: 0, own: 0, client: 0, price: 0, costEst: 0, cost: 0 },
  );
}

export function BatchesPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<DateRangeValue>({ date_from: '', date_to: '' });
  const filter = useMemo(
    () => ({ date_from: range.date_from || undefined, date_to: range.date_to || undefined }),
    [range],
  );
  const query = useQuery({ queryKey: batchKeys.list(filter), queryFn: () => listBatches(filter) });
  const filtered = Boolean(range.date_from || range.date_to);

  const empty = (
    <EmptyState
      title={filtered ? "Tanlangan davrda partiya yo'q" : "Hali partiya yo'q"}
      description={
        filtered
          ? "Sana oralig'ini o'zgartiring yoki filtrni tozalang."
          : "Yangi xarid kiriting yoki Excel fayldan import qiling."
      }
      action={
        !filtered && (
          <Can do="batches.write">
            <ButtonLink to="/batches/new" variant="primary" size="sm" icon={<PlusIcon className="h-3.5 w-3.5" />}>
              Yangi xarid
            </ButtonLink>
          </Can>
        )
      }
    />
  );

  return (
    <div>
      <PageHeader
        title="Partiyalar"
        // iPhone: the explanation moves under the list as a section footnote.
        subtitle={<span className="hidden md:inline">{SUBTITLE}</span>}
        actions={
          <Can do="batches.write">
            <ButtonLink to="/batches/new" variant="primary" icon={<PlusIcon className="h-4 w-4" />}>
              Yangi xarid
            </ButtonLink>
          </Can>
        }
      />

      {/* iPhone: segmented presets, date pills, inset-grouped list */}
      <div className="space-y-6 md:hidden">
        <CompactRangeFilter value={range} onChange={setRange} />
        <QueryView
          query={query}
          isEmpty={(rows) => rows.length === 0}
          loading={
            <Surface>
              <LoadingState rows={6} />
            </Surface>
          }
          empty={<Surface>{empty}</Surface>}
        >
          {(rows) => <BatchList rows={rows} />}
        </QueryView>
      </div>

      {/* iPad and Mac: the accounting table */}
      <Card
        className="hidden md:block"
        title="Partiyalar ro'yxati"
        actions={<DateRangeFilter value={range} onChange={setRange} />}
      >
        <QueryView query={query} isEmpty={(rows) => rows.length === 0} empty={empty}>
          {(rows) => {
            const t = totals(rows);
            const avgOverhead = t.qty > 0 ? (t.cost - t.price) / t.qty : 0;
            return (
              <TableWrap>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Sana</th>
                      <th>Kod</th>
                      <th>Izoh</th>
                      <th className="num">Jami (dona)</th>
                      <th className="num">O'z / mijoz</th>
                      <th className="num">Narx jami ($)</th>
                      <th className="num">Taxminiy tannarx ($)</th>
                      <th className="num">Tannarx ($)</th>
                      <th className="num">O'rt. ustama / dona ($)</th>
                      <th>Xarajatlar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((b) => (
                      <tr key={b.id} className="row-link" onClick={() => navigate(`/batches/${b.id}`)}>
                        <td className="whitespace-nowrap font-medium text-primary-700">
                          <Link to={`/batches/${b.id}`} onClick={(e) => e.stopPropagation()}>
                            {fmtDate(b.batch_date)}
                          </Link>
                        </td>
                        <td>{b.code ?? <span className="text-slate-400">—</span>}</td>
                        <td className="max-w-xs truncate text-slate-500" title={b.note ?? undefined}>
                          {b.note ?? ''}
                        </td>
                        <td className="num font-medium">{fmtQty(b.total_qty)}</td>
                        <td className="num text-slate-500">
                          {fmtQty(b.own_qty)} / {fmtQty(b.client_qty)}
                        </td>
                        <td className="num">{fmtUsd(b.price_usd_total)}</td>
                        <td className="num text-slate-500">{fmtUsd(b.cost_est_total)}</td>
                        <td className="num font-medium">{fmtUsd(b.cost_total)}</td>
                        <td className="num">{fmtUsd(b.overhead_per_unit_avg)}</td>
                        <td>
                          {b.has_actuals ? (
                            <Badge tone="success">Real kiritilgan</Badge>
                          ) : (
                            <Badge tone="warning">Faqat taxminiy</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>Jami: {fmtQty(rows.length)} ta partiya</td>
                      <td className="num">{fmtQty(t.qty)}</td>
                      <td className="num">
                        {fmtQty(t.own)} / {fmtQty(t.client)}
                      </td>
                      <td className="num">{fmtUsd(t.price)}</td>
                      <td className="num">{fmtUsd(t.costEst)}</td>
                      <td className="num">{fmtUsd(t.cost)}</td>
                      <td className="num">{fmtUsd(avgOverhead)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </TableWrap>
            );
          }}
        </QueryView>
      </Card>
    </div>
  );
}

/** Rounded content box for the loading and empty states on iPhone, matching the list sections. */
function Surface({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-[18px] bg-surface shadow-card dark:shadow-none">{children}</div>;
}

/** iPhone: one row per batch (date › quantities and price, landed cost on the right), then the totals. */
function BatchList({ rows }: { rows: BatchSummary[] }) {
  const t = totals(rows);
  const avgOverhead = t.qty > 0 ? (t.cost - t.price) / t.qty : 0;
  return (
    <div className="space-y-8">
      <ListSection header="Partiyalar ro'yxati" footer={SUBTITLE}>
        {rows.map((b) => (
          <ListRow
            key={b.id}
            to={`/batches/${b.id}`}
            title={
              <>
                {fmtDate(b.batch_date)}
                {b.code && <span className="text-slate-500"> · {b.code}</span>}
              </>
            }
            subtitle={`${fmtQty(b.total_qty)} dona · narx ${fmtUsd(b.price_usd_total, { symbol: true, decimals: 0 })}`}
            value={fmtUsd(b.cost_total, { symbol: true })}
            valueStrong
            valueSub={
              b.has_actuals ? <span className="text-success-700">Real kiritilgan</span> : 'Faqat taxminiy'
            }
          />
        ))}
      </ListSection>

      <ListSection header={`Jami: ${fmtQty(rows.length)} ta partiya`}>
        <ListRow
          title="Jami (dona)"
          value={fmtQty(t.qty)}
          valueSub={`o'z ${fmtQty(t.own)} · mijoz ${fmtQty(t.client)}`}
        />
        <ListRow title="Narx jami" value={fmtUsd(t.price, { symbol: true })} />
        <ListRow title="Taxminiy tannarx" value={fmtUsd(t.costEst, { symbol: true })} />
        <ListRow title="Tannarx" value={fmtUsd(t.cost, { symbol: true })} valueStrong />
        <ListRow title="O'rt. ustama / dona" value={fmtUsd(avgOverhead, { symbol: true })} />
      </ListSection>
    </div>
  );
}

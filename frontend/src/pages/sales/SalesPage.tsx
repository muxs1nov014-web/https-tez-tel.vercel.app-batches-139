import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { listSales, saleKeys, type SaleFilter, type SaleSummary } from '../../api/sales';
import { Can } from '../../components/Can';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { ButtonLink } from '../../components/ui/Button';
import { Card, TableWrap } from '../../components/ui/Card';
import { Combobox } from '../../components/ui/Combobox';
import { DateRangeFilter } from '../../components/ui/DateRangeFilter';
import { PlusIcon } from '../../components/ui/icons';
import { ListRow, ListSection } from '../../components/ui/List';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, LoadingState, QueryView } from '../../components/ui/States';
import { StatCard } from '../../components/ui/StatCard';
import { CUSTOMER_KIND_LABELS, SALE_SOURCE_LABELS } from '../../lib/categories';
import { startOfMonthISO, todayISO, type DateRangeValue } from '../../lib/dates';
import { fmtDate, fmtPct, fmtQty, fmtUsd, signClass, toNum } from '../../lib/format';
import { useCustomerList } from '../../lib/queries';
import { RangeRows } from '../reports/FormRows';

const LIST_LIMIT = 2000;

function totalsOf(rows: SaleSummary[]) {
  return rows.reduce(
    (acc, r) => ({
      qty: acc.qty + r.total_qty,
      revenue: acc.revenue + toNum(r.revenue),
      cost: acc.cost + toNum(r.cost),
      profit: acc.profit + toNum(r.profit),
    }),
    { qty: 0, revenue: 0, cost: 0, profit: 0 },
  );
}

function LimitAlert({ className = '' }: { className?: string }) {
  return (
    <Alert tone="warning" className={className}>
      Faqat {fmtQty(LIST_LIMIT)} ta sotuv ko'rsatildi — jami summalar to'liq emas. Sana oralig'ini toraytiring.
    </Alert>
  );
}

/** iPhone: summary widgets, then one row per sale (customer · date · qty … revenue / profit ›). */
function SalesList({ rows }: { rows: SaleSummary[] }) {
  const t = totalsOf(rows);
  return (
    <div className="space-y-4">
      {rows.length >= LIST_LIMIT && <LimitAlert />}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Tushum" value={fmtUsd(t.revenue, { symbol: true })} sub={`Tannarx ${fmtUsd(t.cost, { symbol: true })}`} />
        <StatCard
          label="Foyda"
          value={fmtUsd(t.profit, { symbol: true })}
          valueClassName={signClass(t.profit)}
          sub={t.revenue !== 0 ? `marja ${fmtPct(t.profit / t.revenue, 1)}` : undefined}
        />
      </div>
      <ListSection
        header="Sotuvlar ro'yxati"
        footer={`Jami: ${fmtQty(rows.length)} ta sotuv · ${fmtQty(t.qty)} dona`}
        className="pt-2"
      >
        {rows.map((s) => {
          const revenue = toNum(s.revenue);
          return (
            <ListRow
              key={s.id}
              to={`/sales/${s.id}`}
              title={
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={`truncate ${s.customer ? '' : 'text-slate-500'}`}>
                    {s.customer?.name ?? 'Mijoz tanlanmagan'}
                  </span>
                  {s.source === 'consignment' && <Badge tone="primary">{SALE_SOURCE_LABELS.consignment}</Badge>}
                </span>
              }
              subtitle={`${fmtDate(s.sale_date)} · №${s.id} · ${fmtQty(s.total_qty)} dona`}
              value={fmtUsd(s.revenue, { symbol: true })}
              valueStrong
              valueSub={
                <span className={signClass(s.profit)}>
                  foyda {fmtUsd(s.profit)}
                  {revenue !== 0 ? ` · ${fmtPct(toNum(s.profit) / revenue, 1)}` : ''}
                </span>
              }
            />
          );
        })}
      </ListSection>
    </div>
  );
}

export function SalesPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<DateRangeValue>({ date_from: startOfMonthISO(), date_to: todayISO() });
  const [customerId, setCustomerId] = useState<number | null>(null);
  const customers = useCustomerList();

  const filter = useMemo<SaleFilter>(
    () => ({
      date_from: range.date_from || undefined,
      date_to: range.date_to || undefined,
      customer_id: customerId ?? undefined,
      limit: LIST_LIMIT,
    }),
    [range, customerId],
  );
  const query = useQuery({ queryKey: saleKeys.list(filter), queryFn: () => listSales(filter) });

  return (
    <div>
      <PageHeader
        title="Sotuvlar"
        subtitle="Ulgurji sotuvlar ($). Tannarx FIFO bo'yicha partiyalardan olinadi; real xarajatlar kiritilsa foyda qayta hisoblanadi."
        actions={
          <Can do="sales.write">
            <ButtonLink to="/sales/new" variant="primary" icon={<PlusIcon className="h-4 w-4" />}>
              Yangi sotuv
            </ButtonLink>
          </Can>
        }
      />
      {/* iPhone: filters as a form section, sales as an inset-grouped list. */}
      <div className="space-y-4 md:hidden">
        <Combobox
          className="w-full"
          options={(customers.data ?? []).map((c) => ({
            id: c.id,
            label: c.name,
            hint: CUSTOMER_KIND_LABELS[c.kind],
          }))}
          value={customerId}
          onChange={setCustomerId}
          loading={customers.isPending}
          clearable
          placeholder="Barcha mijozlar"
        />
        <ListSection>
          <RangeRows value={range} onChange={setRange} />
        </ListSection>
        <QueryView
          query={query}
          isEmpty={(rows) => rows.length === 0}
          loading={<LoadingState />}
          empty={
            <EmptyState
              title="Tanlangan davrda sotuv yo'q"
              description="Sana oralig'ini kengaytiring yoki yangi sotuv kiriting."
            />
          }
        >
          {(rows) => <SalesList rows={rows} />}
        </QueryView>
      </div>

      <Card
        className="hidden md:block"
        title="Sotuvlar ro'yxati"
        actions={
          <>
            <Combobox
              className="w-56"
              options={(customers.data ?? []).map((c) => ({
                id: c.id,
                label: c.name,
                hint: CUSTOMER_KIND_LABELS[c.kind],
              }))}
              value={customerId}
              onChange={setCustomerId}
              loading={customers.isPending}
              clearable
              placeholder="Barcha mijozlar"
            />
            <DateRangeFilter value={range} onChange={setRange} />
          </>
        }
      >
        <QueryView
          query={query}
          isEmpty={(rows) => rows.length === 0}
          empty={
            <EmptyState
              title="Tanlangan davrda sotuv yo'q"
              description="Sana oralig'ini kengaytiring yoki yangi sotuv kiriting."
              action={
                <Can do="sales.write">
                  <ButtonLink to="/sales/new" size="sm" variant="primary" icon={<PlusIcon className="h-3.5 w-3.5" />}>
                    Yangi sotuv
                  </ButtonLink>
                </Can>
              }
            />
          }
        >
          {(rows) => {
            const t = totalsOf(rows);
            return (
              <TableWrap>
                {rows.length >= LIST_LIMIT && <LimitAlert className="m-3" />}
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Sana</th>
                      <th>№</th>
                      <th>Mijoz</th>
                      <th className="num">Soni</th>
                      <th className="num">Tushum ($)</th>
                      <th className="num">Tannarx ($)</th>
                      <th className="num">Foyda ($)</th>
                      <th className="num">Marja</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => {
                      const revenue = toNum(s.revenue);
                      return (
                        <tr key={s.id} className="row-link" onClick={() => navigate(`/sales/${s.id}`)}>
                          <td className="whitespace-nowrap font-medium text-primary-700">
                            <Link to={`/sales/${s.id}`} onClick={(e) => e.stopPropagation()}>
                              {fmtDate(s.sale_date)}
                            </Link>
                          </td>
                          <td className="text-slate-500">{s.id}</td>
                          <td>
                            <span className="flex flex-wrap items-center gap-1.5">
                              {s.customer?.name ?? <span className="text-slate-400">—</span>}
                              {s.source === 'consignment' && <Badge tone="primary">{SALE_SOURCE_LABELS.consignment}</Badge>}
                            </span>
                          </td>
                          <td className="num">{fmtQty(s.total_qty)}</td>
                          <td className="num">{fmtUsd(s.revenue)}</td>
                          <td className="num text-slate-500">{fmtUsd(s.cost)}</td>
                          <td className={`num font-medium ${signClass(s.profit)}`}>{fmtUsd(s.profit)}</td>
                          <td className="num text-slate-500">
                            {revenue !== 0 ? fmtPct(toNum(s.profit) / revenue, 1) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>Jami: {fmtQty(rows.length)} ta sotuv</td>
                      <td className="num">{fmtQty(t.qty)}</td>
                      <td className="num">{fmtUsd(t.revenue)}</td>
                      <td className="num">{fmtUsd(t.cost)}</td>
                      <td className={`num ${signClass(t.profit)}`}>{fmtUsd(t.profit)}</td>
                      <td className="num">{t.revenue !== 0 ? fmtPct(t.profit / t.revenue, 1) : '—'}</td>
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

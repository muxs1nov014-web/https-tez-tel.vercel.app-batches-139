import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getProfitReport, reportKeys, type ProfitGroupBy, type ProfitRow } from '../../api/reports';
import { Card, TableWrap } from '../../components/ui/Card';
import { DateRangeFilter } from '../../components/ui/DateRangeFilter';
import { Select } from '../../components/ui/Input';
import { ListRow, ListSection } from '../../components/ui/List';
import { EmptyState, LoadingState, QueryView } from '../../components/ui/States';
import { StatCard } from '../../components/ui/StatCard';
import { fmtDate, fmtMonth, fmtPct, fmtQty, fmtUsd, signClass, toNum } from '../../lib/format';
import { PickerRow, RangeRows } from './FormRows';
import { toApiRange, type RangeProps } from './rangeParams';

const GROUPS: { key: ProfitGroupBy; label: string; column: string }[] = [
  { key: 'product', label: "Mahsulot bo'yicha", column: 'Mahsulot' },
  { key: 'customer', label: "Mijoz bo'yicha", column: 'Mijoz' },
  { key: 'day', label: "Kunlar bo'yicha", column: 'Sana' },
  { key: 'month', label: "Oylar bo'yicha", column: 'Oy' },
];

function parseGroup(value: string): ProfitGroupBy {
  return GROUPS.find((g) => g.key === value)?.key ?? 'product';
}

function rowLabel(row: ProfitRow, groupBy: ProfitGroupBy): string {
  if (groupBy === 'day') return fmtDate(row.key || row.label);
  if (groupBy === 'month') return fmtMonth(row.key || row.label, true);
  if (groupBy === 'customer' && (row.key === 'None' || !row.label || row.label === '—')) {
    return "Mijoz ko'rsatilmagan";
  }
  return row.label || row.key || '—';
}

function sortRows(rows: ProfitRow[], groupBy: ProfitGroupBy): ProfitRow[] {
  const copy = [...rows];
  if (groupBy === 'day' || groupBy === 'month') {
    return copy.sort((a, b) => a.key.localeCompare(b.key));
  }
  return copy.sort((a, b) => toNum(b.profit) - toNum(a.profit));
}

const TITLE = 'Foyda';
const SUBTITLE = 'Tushum − FIFO tannarx. Tannarx partiyalarning joriy amaldagi tannarxidan olinadi.';
const EMPTY = <EmptyState title="Tanlangan davrda sotuv yo'q" description="Sana oralig'ini kengaytiring." />;

function totalsOf(rows: ProfitRow[]) {
  return rows.reduce(
    (acc, r) => ({
      qty: acc.qty + toNum(r.qty),
      revenue: acc.revenue + toNum(r.revenue),
      cost: acc.cost + toNum(r.cost),
      profit: acc.profit + toNum(r.profit),
    }),
    { qty: 0, revenue: 0, cost: 0, profit: 0 },
  );
}

/** iPhone: totals as widgets, then one row per group (profit on the right, its share under it). */
function ProfitList({ rows, groupBy }: { rows: ProfitRow[]; groupBy: ProfitGroupBy }) {
  const t = totalsOf(rows);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Tushum" value={fmtUsd(t.revenue, { symbol: true })} sub={`Tannarx ${fmtUsd(t.cost, { symbol: true })}`} />
        <StatCard
          label="Foyda"
          value={fmtUsd(t.profit, { symbol: true })}
          valueClassName={signClass(t.profit)}
          sub={t.revenue !== 0 ? `marja ${fmtPct(t.profit / t.revenue, 1)} · ${fmtQty(t.qty)} dona` : `${fmtQty(t.qty)} dona`}
        />
      </div>
      <ListSection header={TITLE} footer={SUBTITLE} className="pt-2">
        {rows.map((r, i) => {
          const revenue = toNum(r.revenue);
          const profit = toNum(r.profit);
          return (
            <ListRow
              key={`${r.key}-${i}`}
              title={rowLabel(r, groupBy)}
              subtitle={`${fmtQty(r.qty)} dona · tushum ${fmtUsd(r.revenue)} · marja ${
                revenue !== 0 ? fmtPct(profit / revenue, 1) : '—'
              }`}
              value={<span className={signClass(profit)}>{fmtUsd(profit, { symbol: true })}</span>}
              valueStrong
              valueSub={t.profit !== 0 ? `ulush ${fmtPct(profit / t.profit, 1)}` : undefined}
            />
          );
        })}
      </ListSection>
    </div>
  );
}

export function ProfitReport({ range, onRangeChange, lead }: RangeProps) {
  const [groupBy, setGroupBy] = useState<ProfitGroupBy>('product');
  const apiRange = useMemo(() => toApiRange(range), [range]);
  const query = useQuery({
    queryKey: reportKeys.profit(apiRange, groupBy),
    queryFn: () => getProfitReport(apiRange, groupBy),
  });
  const column = GROUPS.find((g) => g.key === groupBy)?.column ?? '';

  return (
    <>
      <div className="space-y-4 md:hidden">
        <ListSection>
          {lead}
          <PickerRow label="Guruhlash" value={groupBy} options={GROUPS} onChange={setGroupBy} />
          <RangeRows value={range} onChange={onRangeChange} />
        </ListSection>
        <QueryView query={query} isEmpty={(rows) => rows.length === 0} loading={<LoadingState />} empty={EMPTY}>
          {(data) => <ProfitList rows={sortRows(data, groupBy)} groupBy={groupBy} />}
        </QueryView>
      </div>
      <Card
        className="hidden md:block"
        title={TITLE}
        subtitle={SUBTITLE}
        actions={
          <>
            <Select value={groupBy} onChange={(e) => setGroupBy(parseGroup(e.target.value))} className="w-44">
              {GROUPS.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </Select>
            <DateRangeFilter value={range} onChange={onRangeChange} />
          </>
        }
      >
        <QueryView
          query={query}
          isEmpty={(rows) => rows.length === 0}
          empty={EMPTY}
        >
          {(data) => {
            const rows = sortRows(data, groupBy);
            const t = totalsOf(rows);
            return (
              <TableWrap>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{column}</th>
                      <th className="num">Soni</th>
                      <th className="num">Tushum ($)</th>
                      <th className="num">Tannarx ($)</th>
                      <th className="num">Foyda ($)</th>
                      <th className="num">Marja</th>
                      <th className="num">Foyda ulushi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const revenue = toNum(r.revenue);
                      const profit = toNum(r.profit);
                      return (
                        <tr key={`${r.key}-${i}`}>
                          <td className="font-medium">{rowLabel(r, groupBy)}</td>
                          <td className="num">{fmtQty(r.qty)}</td>
                          <td className="num">{fmtUsd(r.revenue)}</td>
                          <td className="num text-slate-500">{fmtUsd(r.cost)}</td>
                          <td className={`num font-medium ${signClass(profit)}`}>{fmtUsd(profit)}</td>
                          <td className="num">{revenue !== 0 ? fmtPct(profit / revenue, 1) : '—'}</td>
                          <td className="num text-slate-500">
                            {t.profit !== 0 ? fmtPct(profit / t.profit, 1) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Jami</td>
                      <td className="num">{fmtQty(t.qty)}</td>
                      <td className="num">{fmtUsd(t.revenue)}</td>
                      <td className="num">{fmtUsd(t.cost)}</td>
                      <td className={`num ${signClass(t.profit)}`}>{fmtUsd(t.profit)}</td>
                      <td className="num">{t.revenue !== 0 ? fmtPct(t.profit / t.revenue, 1) : '—'}</td>
                      <td />
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

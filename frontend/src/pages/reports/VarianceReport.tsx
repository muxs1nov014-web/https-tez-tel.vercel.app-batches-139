import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getBatchVariance, reportKeys, type BatchVarianceRow } from '../../api/reports';
import { Card, TableWrap } from '../../components/ui/Card';
import { DateRangeFilter } from '../../components/ui/DateRangeFilter';
import { ListRow, ListSection } from '../../components/ui/List';
import { EmptyState, LoadingState, QueryView } from '../../components/ui/States';
import { StatCard } from '../../components/ui/StatCard';
import { fmtDate, fmtQty, fmtSignedUsd, fmtUsd, signClass, toNum } from '../../lib/format';
import { RangeRows } from './FormRows';
import { toApiRange, type RangeProps } from './rangeParams';

const TITLE = 'Taxminiy va real xarajatlar farqi';
const SUBTITLE =
  "Partiya bo'yicha: taxminiy tannarx va amaldagi (real kiritilgan) tannarx. Musbat farq — real xarajat taxmindan ko'p.";
const EMPTY = <EmptyState title="Tanlangan davrda partiya yo'q" />;

function totalsOf(rows: BatchVarianceRow[]) {
  return rows.reduce(
    (acc, r) => ({
      qty: acc.qty + toNum(r.qty),
      est: acc.est + toNum(r.cost_est),
      cost: acc.cost + toNum(r.cost),
      diff: acc.diff + toNum(r.diff),
    }),
    { qty: 0, est: 0, cost: 0, diff: 0 },
  );
}

/** iPhone: totals as widgets, then one row per batch (difference on the right, opens the batch). */
function VarianceList({ rows }: { rows: BatchVarianceRow[] }) {
  const t = totalsOf(rows);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Amaldagi tannarx"
          value={fmtUsd(t.cost, { symbol: true })}
          sub={`Taxminiy ${fmtUsd(t.est, { symbol: true })}`}
        />
        <StatCard
          label="Farq"
          value={`${fmtSignedUsd(t.diff)} $`}
          valueClassName={signClass(t.diff, true)}
          sub={`${fmtSignedUsd(t.qty > 0 ? t.diff / t.qty : 0)} $ / dona`}
        />
      </div>
      <ListSection
        header={TITLE}
        footer={`Jami: ${fmtQty(rows.length)} ta partiya · ${fmtQty(t.qty)} dona. ${SUBTITLE}`}
        className="pt-2"
      >
        {rows.map((r) => (
          <ListRow
            key={r.batch_id}
            to={`/batches/${r.batch_id}`}
            title={`Partiya ${fmtDate(r.batch_date)}`}
            subtitle={
              <>
                <span className="block truncate">
                  {fmtQty(r.qty)} dona · taxminiy {fmtUsd(r.cost_est)} $
                </span>
                <span className="block truncate">amaldagi {fmtUsd(r.cost)} $</span>
              </>
            }
            value={<span className={signClass(r.diff, true)}>{fmtSignedUsd(r.diff)}</span>}
            valueStrong
            valueSub={`${fmtSignedUsd(r.diff_per_unit)} / dona`}
          />
        ))}
      </ListSection>
    </div>
  );
}

export function VarianceReport({ range, onRangeChange, lead }: RangeProps) {
  const apiRange = useMemo(() => toApiRange(range), [range]);
  const query = useQuery({ queryKey: reportKeys.variance(apiRange), queryFn: () => getBatchVariance(apiRange) });

  return (
    <>
      <div className="space-y-4 md:hidden">
        <ListSection>
          {lead}
          <RangeRows value={range} onChange={onRangeChange} />
        </ListSection>
        <QueryView query={query} isEmpty={(rows) => rows.length === 0} loading={<LoadingState />} empty={EMPTY}>
          {(rows) => <VarianceList rows={rows} />}
        </QueryView>
      </div>
      <Card
        className="hidden md:block"
        title={TITLE}
        subtitle={SUBTITLE}
        actions={<DateRangeFilter value={range} onChange={onRangeChange} />}
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
                      <th>Partiya</th>
                      <th className="num">Soni</th>
                      <th className="num">Taxminiy tannarx ($)</th>
                      <th className="num">Amaldagi tannarx ($)</th>
                      <th className="num">Farq ($)</th>
                      <th className="num">Farq / dona ($)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.batch_id}>
                        <td>
                          <Link to={`/batches/${r.batch_id}`} className="font-medium text-primary-700 hover:underline">
                            {fmtDate(r.batch_date)}
                          </Link>
                        </td>
                        <td className="num">{fmtQty(r.qty)}</td>
                        <td className="num">{fmtUsd(r.cost_est)}</td>
                        <td className="num">{fmtUsd(r.cost)}</td>
                        <td className={`num font-medium ${signClass(r.diff, true)}`}>{fmtSignedUsd(r.diff)}</td>
                        <td className={`num ${signClass(r.diff_per_unit, true)}`}>{fmtSignedUsd(r.diff_per_unit)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Jami: {fmtQty(rows.length)} ta partiya</td>
                      <td className="num">{fmtQty(t.qty)}</td>
                      <td className="num">{fmtUsd(t.est)}</td>
                      <td className="num">{fmtUsd(t.cost)}</td>
                      <td className={`num ${signClass(t.diff, true)}`}>{fmtSignedUsd(t.diff)}</td>
                      <td className={`num ${signClass(t.diff, true)}`}>
                        {fmtSignedUsd(t.qty > 0 ? t.diff / t.qty : 0)}
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

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getUnitCostHistory, reportKeys, type UnitCostRow } from '../../api/reports';
import { ProductSelect } from '../../components/ProductSelect';
import { Card, TableWrap } from '../../components/ui/Card';
import { ListRow, ListSection } from '../../components/ui/List';
import { EmptyState, LoadingState, QueryView } from '../../components/ui/States';
import { fmtDate, fmtQty, fmtUsd, toNum } from '../../lib/format';
import {
  ChartPanel,
  ChartTooltip,
  LegendItem,
  SERIES_COLORS,
  compactNumber,
  gridProps,
  lineCursor,
  xAxisProps,
  yAxisProps,
  type Series,
} from '../dashboard/chartKit';
import type { LeadProps } from './rangeParams';

const TITLE = 'Tannarx tarixi';
const SUBTITLE = "Mahsulotning har bir partiyadagi narxi, ustamasi va amaldagi tannarxi.";

const SERIES: Series[] = [
  { key: 'price', name: 'Narx', ...SERIES_COLORS.gray },
  { key: 'unit_cost', name: 'Tannarx', ...SERIES_COLORS.blue },
];

const SURFACE = 'rgb(var(--c-surface))';

function sortByDate(data: UnitCostRow[]): UnitCostRow[] {
  return [...data].sort((a, b) => (a.batch_date < b.batch_date ? -1 : 1));
}

/** Price and landed cost per batch, Stocks style: smooth lines, no dots until hovered. */
function UnitCostChart({ rows }: { rows: UnitCostRow[] }) {
  const chart = rows.map((r) => ({
    label: fmtDate(r.batch_date),
    price: toNum(r.price_usd),
    unit_cost: toNum(r.unit_cost),
  }));
  return (
    <div className="h-56 sm:h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chart} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="label" tickFormatter={(v: string) => v.slice(0, 5)} {...xAxisProps} />
          <YAxis
            orientation="right"
            width={48}
            domain={['auto', 'auto']}
            tickFormatter={compactNumber}
            {...yAxisProps}
          />
          <Tooltip
            cursor={lineCursor}
            content={
              <ChartTooltip series={SERIES} format={(v) => fmtUsd(v, { symbol: true })} heading={(label) => label} />
            }
          />
          {SERIES.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2.25}
              strokeLinecap="round"
              dot={false}
              activeDot={{ r: 4.5, strokeWidth: 2, stroke: SURFACE, fill: s.color }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartLegend({ rows }: { rows: UnitCostRow[] }) {
  const last = rows[rows.length - 1];
  return (
    <>
      <LegendItem series={SERIES[0]} value={fmtUsd(last.price_usd)} unit="$" />
      <LegendItem series={SERIES[1]} value={fmtUsd(last.unit_cost)} unit="$" />
    </>
  );
}

export function UnitCostReport({ lead }: LeadProps) {
  const [productId, setProductId] = useState<number | null>(null);
  const query = useQuery({
    queryKey: reportKeys.unitCost(productId ?? 0),
    queryFn: () => getUnitCostHistory(productId ?? 0),
    enabled: productId !== null,
  });
  const noProduct = (
    <EmptyState title="Mahsulotni tanlang" description="Tannarx dinamikasini ko'rish uchun yuqoridan mahsulot tanlang." />
  );
  const noRows = <EmptyState title="Bu mahsulot bo'yicha xarid yo'q" />;

  return (
    <>
      {/* iPhone: picker, product field, chart widget and one row per batch (newest first). */}
      <div className="space-y-4 md:hidden">
        {lead && <ListSection>{lead}</ListSection>}
        <ProductSelect className="w-full" value={productId} onChange={setProductId} placeholder="Mahsulotni tanlang…" />
        {productId === null ? (
          noProduct
        ) : (
          <QueryView query={query} isEmpty={(rows) => rows.length === 0} loading={<LoadingState />} empty={noRows}>
            {(data) => {
              const rows = sortByDate(data);
              return (
                <>
                  {rows.length > 1 && (
                    <ChartPanel title={TITLE} subtitle={SUBTITLE} legend={<ChartLegend rows={rows} />}>
                      <UnitCostChart rows={rows} />
                    </ChartPanel>
                  )}
                  <ListSection header="Partiyalar" className="pt-2">
                    {[...rows].reverse().map((r, i) => (
                      <ListRow
                        key={`${r.batch_date}-${i}`}
                        title={fmtDate(r.batch_date)}
                        subtitle={`${fmtQty(r.qty)} dona · narx ${fmtUsd(r.price_usd)} · ustama ${fmtUsd(r.overhead)}`}
                        value={fmtUsd(r.unit_cost, { symbol: true })}
                        valueStrong
                        valueSub="tannarx"
                      />
                    ))}
                  </ListSection>
                </>
              );
            }}
          </QueryView>
        )}
      </div>

      <Card
        className="hidden md:block"
        title={TITLE}
        subtitle={SUBTITLE}
        actions={
          <ProductSelect className="w-80" value={productId} onChange={setProductId} placeholder="Mahsulotni tanlang…" />
        }
      >
        {productId === null ? (
          noProduct
        ) : (
          <QueryView query={query} isEmpty={(rows) => rows.length === 0} empty={noRows}>
            {(data) => {
              const rows = sortByDate(data);
              return (
                <div>
                  {rows.length > 1 && (
                    <div className="border-b border-slate-200 px-5 pb-3 pt-4">
                      <div className="mb-3 flex flex-wrap gap-x-6 gap-y-2">
                        <ChartLegend rows={rows} />
                      </div>
                      <UnitCostChart rows={rows} />
                    </div>
                  )}
                  <TableWrap>
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Partiya sanasi</th>
                          <th className="num">Soni</th>
                          <th className="num">Narx ($)</th>
                          <th className="num">Ustama ($)</th>
                          <th className="num">Tannarx ($)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...rows].reverse().map((r, i) => (
                          <tr key={`${r.batch_date}-${i}`}>
                            <td>{fmtDate(r.batch_date)}</td>
                            <td className="num">{fmtQty(r.qty)}</td>
                            <td className="num">{fmtUsd(r.price_usd)}</td>
                            <td className="num">{fmtUsd(r.overhead)}</td>
                            <td className="num font-semibold">{fmtUsd(r.unit_cost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                </div>
              );
            }}
          </QueryView>
        )}
      </Card>
    </>
  );
}

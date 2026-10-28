import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getDashboard, reportKeys, type Dashboard } from '../../api/reports';
import { Card, TableWrap } from '../../components/ui/Card';
import { ListRow, ListSection } from '../../components/ui/List';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, QueryView } from '../../components/ui/States';
import { ArchiveIcon, BanknotesIcon, CartIcon, ChartIcon, CubeIcon, ReceiptIcon, TrendUpIcon } from '../../components/ui/icons';
import { StatCard } from '../../components/ui/StatCard';
import { fmtMonth, fmtQty, fmtUsd, signClass, toNum } from '../../lib/format';
import { NasiyaDashboardCard } from '../nasiya/NasiyaDashboardCard';
import {
  BAR_RADIUS,
  ChartPanel,
  ChartTooltip,
  LegendItem,
  SERIES_COLORS,
  allZero,
  barCursor,
  compactNumber,
  gridProps,
  monthTick,
  xAxisProps,
  yAxisProps,
  type Series,
} from './chartKit';

interface ChartRow {
  month: string;
  label: string;
  purchases_qty: number;
  purchases_usd: number;
  sales_qty: number;
  revenue: number;
  profit: number;
}

function toChartRows(data: Dashboard): ChartRow[] {
  return data.monthly.map((m) => ({
    month: m.month,
    label: fmtMonth(m.month),
    purchases_qty: toNum(m.purchases_qty),
    purchases_usd: toNum(m.purchases_usd),
    sales_qty: toNum(m.sales_qty),
    revenue: toNum(m.revenue),
    profit: toNum(m.profit),
  }));
}

function sum(rows: ChartRow[], get: (row: ChartRow) => number): number {
  return rows.reduce((acc, r) => acc + get(r), 0);
}

const SALES_SERIES: Series[] = [
  { key: 'revenue', name: 'Tushum', ...SERIES_COLORS.blue },
  { key: 'profit', name: 'Foyda', ...SERIES_COLORS.green },
];

const PURCHASE_SERIES: Series[] = [
  { key: 'purchases_qty', name: 'Xarid', ...SERIES_COLORS.blue },
  { key: 'sales_qty', name: 'Sotuv', ...SERIES_COLORS.green },
  { key: 'purchases_usd', name: 'Xarid summasi', ...SERIES_COLORS.orange },
];

const CHART_BOX = 'h-56 sm:h-64';
const CHART_MARGIN = { top: 8, right: 0, left: 0, bottom: 0 };
const SURFACE = 'rgb(var(--c-surface))';

function usd(value: number): string {
  return fmtUsd(value, { symbol: true });
}

function RevenueChart({ rows }: { rows: ChartRow[] }) {
  const empty = allZero(rows, [(r) => r.revenue, (r) => r.profit]);
  const [revenue, profit] = SALES_SERIES;
  return (
    <ChartPanel
      title="Oylik tushum va foyda ($)"
      subtitle="So'nggi 12 oy"
      legend={
        empty ? undefined : (
          <>
            <LegendItem series={revenue} value={fmtUsd(sum(rows, (r) => r.revenue), { decimals: 0 })} unit="$" />
            <LegendItem series={profit} value={fmtUsd(sum(rows, (r) => r.profit), { decimals: 0 })} unit="$" />
          </>
        )
      }
    >
      {empty ? (
        <EmptyState
          className={`${CHART_BOX} py-0`}
          title="Hali sotuv yo'q"
          description="Sotuvlar kiritilgach, oylik tushum va foyda shu yerda ko'rinadi."
        />
      ) : (
        <div className={CHART_BOX}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={CHART_MARGIN} barGap={3} barCategoryGap="24%">
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="month" tickFormatter={monthTick} {...xAxisProps} />
              <YAxis orientation="right" width={44} tickFormatter={compactNumber} {...yAxisProps} />
              <Tooltip cursor={barCursor} content={<ChartTooltip series={SALES_SERIES} format={usd} />} />
              <Bar dataKey="revenue" name={revenue.name} fill={revenue.color} radius={BAR_RADIUS} maxBarSize={14} />
              <Bar dataKey="profit" name={profit.name} fill={profit.color} radius={BAR_RADIUS} maxBarSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartPanel>
  );
}

function PurchasesChart({ rows }: { rows: ChartRow[] }) {
  const empty = allZero(rows, [(r) => r.purchases_qty, (r) => r.sales_qty, (r) => r.purchases_usd]);
  const [purchases, sales, purchasesUsd] = PURCHASE_SERIES;
  return (
    <ChartPanel
      title="Oylik xarid va sotuv (dona) · xarid summasi ($)"
      subtitle="So'nggi 12 oy"
      legend={
        empty ? undefined : (
          <>
            <LegendItem series={purchases} value={fmtQty(sum(rows, (r) => r.purchases_qty))} unit="dona" />
            <LegendItem series={sales} value={fmtQty(sum(rows, (r) => r.sales_qty))} unit="dona" />
            <LegendItem
              series={purchasesUsd}
              value={fmtUsd(sum(rows, (r) => r.purchases_usd), { decimals: 0 })}
              unit="$"
            />
          </>
        )
      }
    >
      {empty ? (
        <EmptyState
          className={`${CHART_BOX} py-0`}
          title="Hali xarid yo'q"
          description="Xaridlar kiritilgach, oylik xarid va sotuv shu yerda ko'rinadi."
        />
      ) : (
        <div className={CHART_BOX}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={CHART_MARGIN} barGap={3} barCategoryGap="24%">
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="month" tickFormatter={monthTick} {...xAxisProps} />
              <YAxis yAxisId="qty" orientation="left" width={40} tickFormatter={compactNumber} {...yAxisProps} />
              <YAxis yAxisId="usd" orientation="right" width={44} tickFormatter={compactNumber} {...yAxisProps} />
              <Tooltip
                cursor={barCursor}
                content={
                  <ChartTooltip
                    series={PURCHASE_SERIES}
                    format={(value, key) => (key === 'purchases_usd' ? usd(value) : `${fmtQty(value)} dona`)}
                  />
                }
              />
              <Bar
                yAxisId="qty"
                dataKey="purchases_qty"
                name={purchases.name}
                fill={purchases.color}
                radius={BAR_RADIUS}
                maxBarSize={14}
              />
              <Bar
                yAxisId="qty"
                dataKey="sales_qty"
                name={sales.name}
                fill={sales.color}
                radius={BAR_RADIUS}
                maxBarSize={14}
              />
              <Line
                yAxisId="usd"
                type="monotone"
                dataKey="purchases_usd"
                name={purchasesUsd.name}
                stroke={purchasesUsd.color}
                strokeWidth={2.25}
                strokeLinecap="round"
                dot={false}
                activeDot={{ r: 4.5, strokeWidth: 2, stroke: SURFACE, fill: purchasesUsd.color }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartPanel>
  );
}

/** iPhone: one inset-grouped row per month, newest first. */
function MonthList({ rows }: { rows: ChartRow[] }) {
  return (
    <ListSection header="Oylar kesimida" className="pt-4 md:hidden">
      {rows.length === 0 ? (
        <li>
          <EmptyState title="Oylik ma'lumot yo'q" />
        </li>
      ) : (
        [...rows].reverse().map((r) => (
          <ListRow
            key={r.month}
            title={fmtMonth(r.month, true)}
            subtitle={
              <>
                <span className="block truncate">
                  Xarid {fmtQty(r.purchases_qty)} dona · sotuv {fmtQty(r.sales_qty)} dona
                </span>
                <span className="block truncate">Xarid summasi {usd(r.purchases_usd)}</span>
              </>
            }
            value={usd(r.revenue)}
            valueStrong
            valueSub={<span className={signClass(r.profit)}>foyda {fmtUsd(r.profit)}</span>}
          />
        ))
      )}
    </ListSection>
  );
}

export function DashboardPage() {
  const query = useQuery({ queryKey: reportKeys.dashboard, queryFn: getDashboard });

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Ombor, joriy oy va so'nggi 12 oy ko'rsatkichlari" />
      <QueryView query={query}>
        {(data) => {
          const rows = toChartRows(data);
          const hasActivity = rows.some((r) => r.purchases_qty > 0 || r.sales_qty > 0);
          const nasiyaQty = toNum(data.month.nasiya_sales_qty);
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <StatCard icon={CubeIcon} tint="brown" label="Ombordagi qoldiq" value={`${fmtQty(data.stock_qty)} dona`} />
                <StatCard icon={BanknotesIcon} tint="green" label="Ombor qiymati" value={fmtUsd(data.stock_value, { symbol: true })} />
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                <StatCard
                  icon={CartIcon}
                  tint="pink"
                  label="Shu oy sotuv"
                  value={`${fmtQty(data.month.sales_qty)} dona`}
                  sub={nasiyaQty > 0 ? `${fmtQty(nasiyaQty)} dona nasiya fayllaridan` : undefined}
                />
                <StatCard
                  icon={ChartIcon}
                  tint="blue"
                  label="Shu oy tushum"
                  value={fmtUsd(data.month.revenue, { symbol: true })}
                  sub={nasiyaQty > 0 ? `${fmtUsd(data.month.nasiya_revenue, { symbol: true })} nasiya sotuvi` : undefined}
                />
                <StatCard
                  icon={TrendUpIcon}
                  tint="mint"
                  label="Shu oy foyda"
                  value={fmtUsd(data.month.profit, { symbol: true })}
                  valueClassName={signClass(data.month.profit)}
                  sub={nasiyaQty > 0 ? "Nasiya sotuvi tannarxsiz — foydaga kirmagan" : undefined}
                />
                <StatCard icon={ArchiveIcon} tint="orange" label="Shu oy xarid" value={`${fmtQty(data.month.purchases_qty)} dona`} />
                {/* Odd card out on iPhone: a "medium" widget across both columns. */}
                <div className="col-span-2 md:col-span-1">
                  <StatCard icon={ReceiptIcon} tint="purple" label="Shu oy xarid summasi" value={fmtUsd(data.month.purchases_usd, { symbol: true })} />
                </div>
              </div>

              <NasiyaDashboardCard />

              {!hasActivity ? (
                <Card>
                  <EmptyState
                    title="So'nggi 12 oyda harakat yo'q"
                    description="Xaridlar yoki sotuvlar kiritilgach, bu yerda oylik grafiklar paydo bo'ladi."
                  />
                </Card>
              ) : (
                <div className="grid gap-4 xl:grid-cols-2">
                  <RevenueChart rows={rows} />
                  <PurchasesChart rows={rows} />
                </div>
              )}

              <MonthList rows={rows} />

              <Card title="Oylar kesimida" className="hidden md:block">
                <TableWrap>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Oy</th>
                        <th className="num">Xarid (dona)</th>
                        <th className="num">Xarid ($)</th>
                        <th className="num">Sotuv (dona)</th>
                        <th className="num">Tushum ($)</th>
                        <th className="num">Foyda ($)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={6}>
                            <EmptyState title="Oylik ma'lumot yo'q" />
                          </td>
                        </tr>
                      ) : (
                        [...rows].reverse().map((r) => (
                          <tr key={r.month}>
                            <td>{fmtMonth(r.month, true)}</td>
                            <td className="num">{fmtQty(r.purchases_qty)}</td>
                            <td className="num">{fmtUsd(r.purchases_usd)}</td>
                            <td className="num">{fmtQty(r.sales_qty)}</td>
                            <td className="num">{fmtUsd(r.revenue)}</td>
                            <td className={`num ${signClass(r.profit)}`}>{fmtUsd(r.profit)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </TableWrap>
              </Card>
            </div>
          );
        }}
      </QueryView>
    </div>
  );
}

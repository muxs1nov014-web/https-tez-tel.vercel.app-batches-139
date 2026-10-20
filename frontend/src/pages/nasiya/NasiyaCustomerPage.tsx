import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getNasiyaCustomer, nasiyaKeys, type NasiyaCustomerDetail, type NasiyaKind } from '../../api/nasiya';
import { Alert } from '../../components/ui/Alert';
import { Card, TableWrap } from '../../components/ui/Card';
import { BanknotesIcon, CubeIcon, TrendUpIcon, WarningIcon } from '../../components/ui/icons';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { StatCard } from '../../components/ui/StatCard';
import { Tabs } from '../../components/ui/Tabs';
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
import { MonthsCard } from './MonthsCard';
import { EventsTable } from './NasiyaPage';
import { AgeBadge, ImeiTrailModal, KIND_LABELS, KindBadge } from './shared';

const BACK = { to: '/nasiya', label: 'Nasiya nazorati' };

export function NasiyaCustomerPage() {
  const params = useParams();
  const customerId = Number(params.customerId);
  const valid = Number.isInteger(customerId) && customerId > 0;
  const query = useQuery({
    queryKey: nasiyaKeys.customer(customerId),
    queryFn: () => getNasiyaCustomer(customerId),
    enabled: valid,
  });
  if (!valid) return <EmptyState title="Mijoz topilmadi" />;
  if (query.isPending) {
    return (
      <div>
        <PageHeader title="Mijoz" back={BACK} />
        <LoadingState rows={10} />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div>
        <PageHeader title="Mijoz" back={BACK} />
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      </div>
    );
  }
  return <CustomerView data={query.data} />;
}

type Filter = NasiyaKind | 'debt' | 'all';

function CustomerView({ data }: { data: NasiyaCustomerDetail }) {
  const [filter, setFilter] = useState<Filter>('debt');
  const [trailImei, setTrailImei] = useState<string | null>(null);
  const row = data.row;
  const counts = useMemo(() => {
    const c: Record<NasiyaKind, number> = { nasiya: 0, variant: 0, qoldiq: 0, sotuv: 0 };
    for (const i of data.items) c[i.kind] += i.qty;
    return c;
  }, [data.items]);
  const items = data.items.filter((i) =>
    filter === 'all' ? true : filter === 'debt' ? i.kind === 'nasiya' || i.kind === 'variant' : i.kind === filter,
  );
  const tabs: { key: Filter; label: string }[] = [
    { key: 'debt', label: `Nasiya · ${counts.nasiya + counts.variant}` },
    { key: 'qoldiq', label: `Qoldiq · ${counts.qoldiq}` },
    { key: 'sotuv', label: `To'landi · ${counts.sotuv}` },
    { key: 'all', label: 'Hammasi' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        back={BACK}
        title={data.customer.name}
        subtitle={
          data.report ? (
            <>
              <Link to={`/nasiya/reports/${data.report.id}`} className="text-primary-700 hover:underline">
                {fmtDate(data.report.report_date)}
              </Link>{' '}
              holatiga · varaq: {row?.sheet_name ?? '—'} ·{' '}
              <Link to={`/customers/${data.customer.id}`} className="text-primary-700 hover:underline">
                mijoz hisobi
              </Link>
            </>
          ) : (
            "Tasdiqlangan hisobot yo'q"
          )
        }
      />
      {!row ? (
        <Card>
          <EmptyState title="Bu mijoz oxirgi tasdiqlangan hisobotda yo'q" />
        </Card>
      ) : (
        <>
          {row.over_limit && (
            <Alert tone="danger" title="Limitdan oshgan">
              Nasiya va qoldiq {fmtUsd(row.exposure_usd, { symbol: true })}, limit {fmtUsd(row.limit_usd, { symbol: true })}.
            </Alert>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Nasiya"
              icon={BanknotesIcon}
              tint="orange"
              value={fmtUsd(row.totals.debt_usd, { symbol: true })}
              sub={`${fmtQty(row.totals.debt_qty)} dona${toNum(row.totals.variant_usd) ? ` · variant ${fmtUsd(row.totals.variant_usd, { decimals: 0 })} $` : ''}`}
            />
            <StatCard
              label="Qoldiq (bizning mol)"
              icon={CubeIcon}
              tint="brown"
              value={`${fmtQty(row.totals.qoldiq_qty)} dona`}
              sub={toNum(row.totals.qoldiq_value_usd) ? `${fmtUsd(row.totals.qoldiq_value_usd, { symbol: true })} (varaq bo'yicha)` : undefined}
            />
            <StatCard
              label="Bugun to'landi"
              icon={TrendUpIcon}
              tint="green"
              value={fmtUsd(row.paid_usd, { symbol: true })}
              sub={`yangi nasiya ${fmtUsd(row.new_debt_usd, { symbol: true })}`}
            />
            <StatCard
              label="Limit"
              icon={WarningIcon}
              tint={row.over_limit ? 'red' : 'gray'}
              value={row.limit_usd === null ? "yo'q" : fmtUsd(row.limit_usd, { symbol: true, decimals: 0 })}
              valueClassName={row.over_limit ? 'text-danger-600' : 'text-slate-900'}
              sub={row.available_usd === null ? undefined : `bo'sh: ${fmtUsd(row.available_usd, { symbol: true, decimals: 0 })}`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <CustomerChart data={data} />
            </div>
            <Card title="Modellar" subtitle="Shu kungi holat, model bo'yicha.">
              <TableWrap>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th className="num">Dona</th>
                      <th className="num">$</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.models.map((m) => (
                      <tr key={`${m.kind}-${m.model}`}>
                        <td>
                          <div className="font-medium">{m.model}</div>
                          <div className="text-[11px] text-slate-500">{KIND_LABELS[m.kind]}</div>
                        </td>
                        <td className="num">{fmtQty(m.qty)}</td>
                        <td className="num">{toNum(m.amount) ? fmtUsd(m.amount, { decimals: 0 }) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </Card>
          </div>

          {data.schedule.length > 0 && (
            <Card title="Variant: to'lov muddatlari" subtitle="Varaqdagi jadval bo'yicha.">
              <TableWrap>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Sana</th>
                      <th className="num">Summa ($)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.schedule.map((s) => (
                      <tr key={s.date}>
                        <td>{fmtDate(s.date)}</td>
                        <td className="num">{fmtUsd(s.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </Card>
          )}

          <Card
            title="Telefonlar"
            subtitle="Har bir telefon: model, IMEI, narx va shu holatda necha kundan beri turgani. IMEI ni bossangiz, tarixi chiqadi."
          >
            <div className="px-4 pt-3">
              <Tabs tabs={tabs} value={filter} onChange={setFilter} />
            </div>
            {items.length === 0 ? (
              <EmptyState title="Telefon yo'q" />
            ) : (
              <TableWrap>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Holati</th>
                      <th>Model</th>
                      <th>IMEI</th>
                      <th className="num">Narx ($)</th>
                      <th>Qachondan</th>
                      <th className="num">Necha kun</th>
                      <th className="num">Muddat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i, idx) => (
                      <tr key={`${i.imei ?? 'x'}-${idx}`}>
                        <td>
                          <KindBadge kind={i.kind} />
                        </td>
                        <td className="font-medium">{i.model}</td>
                        <td className="whitespace-nowrap font-mono text-[12px]">
                          {i.imei ? (
                            <button type="button" className="text-primary-700 hover:underline" onClick={() => setTrailImei(i.imei)}>
                              {i.imei}
                            </button>
                          ) : (
                            <span className="text-slate-500">IMEI siz · {i.qty} dona</span>
                          )}
                        </td>
                        <td className={`num ${i.price_usd === null && i.kind !== 'qoldiq' ? 'font-semibold text-danger-600' : ''}`}>
                          {i.price_usd === null ? (i.kind === 'qoldiq' ? '—' : "yo'q") : fmtUsd(i.price_usd)}
                        </td>
                        <td className="whitespace-nowrap">{i.since ? `${i.since_exact ? '' : '≤ '}${fmtDate(i.since)}` : '—'}</td>
                        <td className="num">
                          <AgeBadge days={i.age_days} exact={i.since_exact} overdue={i.overdue} />
                        </td>
                        <td className="num">{i.term_days ? `${i.term_days} kun` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          <MonthsCard customerId={data.customer.id} />

          {data.events.length > 0 && (
            <Card title="Oldingi kun bilan farq" subtitle="Shu mijoz bo'yicha IMEI o'zgarishlari.">
              <EventsTable events={data.events} onImei={setTrailImei} />
            </Card>
          )}
        </>
      )}
      {trailImei && <ImeiTrailModal imei={trailImei} onClose={() => setTrailImei(null)} />}
    </div>
  );
}

const DEBT: Series = { key: 'debt', name: 'Nasiya', ...SERIES_COLORS.orange };
const PAID: Series = { key: 'paid', name: "To'landi", ...SERIES_COLORS.green };

function CustomerChart({ data }: { data: NasiyaCustomerDetail }) {
  const rows = data.series.map((p) => ({ label: fmtDate(p.date).slice(0, 5), debt: toNum(p.debt_usd), paid: toNum(p.sotuv_usd) }));
  if (rows.length < 2) {
    return (
      <ChartPanel title="Nasiya dinamikasi" subtitle="Kamida ikki kun tasdiqlanganda grafik chiqadi.">
        <div className="h-[200px]" />
      </ChartPanel>
    );
  }
  const last = rows[rows.length - 1];
  return (
    <ChartPanel
      title="Nasiya dinamikasi"
      subtitle={`So'nggi ${rows.length} ta tasdiqlangan kun`}
      legend={
        <>
          <LegendItem series={DEBT} value={fmtUsd(last.debt, { decimals: 0 })} unit="$" />
          <LegendItem series={PAID} value={fmtUsd(last.paid, { decimals: 0 })} unit="$ oxirgi kun" />
        </>
      }
    >
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...xAxisProps} />
            <YAxis orientation="right" tickFormatter={compactNumber} {...yAxisProps} width={44} />
            <Tooltip
              cursor={lineCursor}
              content={<ChartTooltip series={[DEBT, PAID]} format={(v) => fmtUsd(v, { symbol: true, decimals: 0 })} heading={(l) => l} />}
            />
            <Line dataKey="debt" stroke={DEBT.color} strokeWidth={2.2} dot={false} type="monotone" />
            <Line dataKey="paid" stroke={PAID.color} strokeWidth={1.6} dot={false} type="monotone" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartPanel>
  );
}

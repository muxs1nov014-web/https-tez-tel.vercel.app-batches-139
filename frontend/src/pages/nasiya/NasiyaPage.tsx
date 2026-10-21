import { useRef, useState, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { errorMessage } from '../../api/client';
import {
  getNasiyaOverview,
  getNasiyaSeries,
  listNasiyaReports,
  nasiyaKeys,
  uploadNasiyaReport,
  type NasiyaAgingBucket,
  type NasiyaCustomerRow,
  type NasiyaEvent,
  type NasiyaOverview,
  type NasiyaSeriesPoint,
  type NasiyaStatus,
} from '../../api/nasiya';
import { Can } from '../../components/Can';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, TableWrap } from '../../components/ui/Card';
import { BanknotesIcon, ClipboardCheckIcon, TrendUpIcon, UploadIcon, WarningIcon } from '../../components/ui/icons';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, QueryView } from '../../components/ui/States';
import { StatCard } from '../../components/ui/StatCard';
import { Tabs } from '../../components/ui/Tabs';
import { useToast } from '../../components/ui/Toast';
import { fmtDate, fmtDateTime, fmtQty, fmtSignedUsd, fmtUsd, signClass, toNum } from '../../lib/format';
import {
  BAR_RADIUS,
  ChartPanel,
  ChartTooltip,
  LegendItem,
  SERIES_COLORS,
  barCursor,
  compactNumber,
  gridProps,
  xAxisProps,
  yAxisProps,
  type Series,
} from '../dashboard/chartKit';
import { MonthsCard } from './MonthsCard';
import { NasiyaPhonesView } from './NasiyaPhonesView';
import { ProcessButton, RefreshButton } from './ProcessButton';
import { EVENT_HINTS, EVENT_LABELS, ImeiSearch, ImeiTrailModal, StatusBadge } from './shared';

type TabKey = 'overview' | 'phones' | 'reports';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Kunlik nazorat' },
  { key: 'phones', label: 'Telefonlar (kunlar)' },
  { key: 'reports', label: 'Hisobotlar' },
];

export function NasiyaPage() {
  const [params, setParams] = useSearchParams();
  const tab: TabKey = TABS.find((t) => t.key === params.get('tab'))?.key ?? 'overview';
  const overview = useQuery({ queryKey: nasiyaKeys.overview(), queryFn: () => getNasiyaOverview() });
  const pending = overview.data?.pending_reports ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Nasiya nazorati"
        subtitle="«Telefon nasiya nazorat» guruhidagi kunlik Excel: har bir telefon IMEI bo'yicha. Fayl avval tekshiriladi, tasdiqlangan kunlar nazoratga kiradi."
        actions={
          <Can do="nasiya.review">
            <RefreshButton />
            <ProcessButton />
            <UploadButton />
          </Can>
        }
      />
      <Tabs
        tabs={TABS.map((t) => (t.key === 'reports' && pending ? { ...t, label: `${t.label} · ${pending} kutilmoqda` } : t))}
        value={tab}
        onChange={(key) => setParams(key === 'overview' ? {} : { tab: key }, { replace: true })}
      />
      {tab === 'overview' && <QueryView query={overview}>{(data) => <OverviewView data={data} />}</QueryView>}
      {tab === 'phones' && <NasiyaPhonesView />}
      {tab === 'reports' && <ReportsView />}
    </div>
  );
}

// ---- actions ----
function UploadButton() {
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setBusy(true);
    const created: number[] = [];
    const failed: string[] = [];
    let duplicates = 0;
    // One request per file: a day's workbook is small, and one bad file does not stop the others.
    for (const file of files) {
      try {
        const result = await uploadNasiyaReport(file);
        if (result.error) failed.push(`${file.name}: ${result.error}`);
        else if (result.duplicate) duplicates += 1;
        else if (result.report_id) created.push(result.report_id);
      } catch (err) {
        failed.push(`${file.name}: ${errorMessage(err)}`);
      }
    }
    setBusy(false);
    await queryClient.invalidateQueries({ queryKey: nasiyaKeys.all });
    if (failed.length) toast.error(failed.join('\n'));
    if (created.length || duplicates) {
      toast.success(
        [created.length ? `${created.length} ta yangi hisobot` : '', duplicates ? `${duplicates} tasi avval yuklangan` : '']
          .filter(Boolean)
          .join(', '),
      );
    }
    if (files.length === 1 && created.length === 1) navigate(`/nasiya/reports/${created[0]}`);
  };

  return (
    <>
      <input ref={input} type="file" accept=".xlsx,.xlsm" multiple hidden onChange={(e) => void onFiles(e)} />
      <Button variant="primary" loading={busy} icon={<UploadIcon className="h-4 w-4" />} onClick={() => input.current?.click()}>
        Excel yuklash
      </Button>
    </>
  );
}

// ---- overview ----
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function OverviewView({ data }: { data: NasiyaOverview }) {
  const [trailImei, setTrailImei] = useState<string | null>(null);
  if (!data.report || !data.totals) {
    return (
      <Card>
        <EmptyState
          title="Hali hisoblangan kun yo'q"
          description={
            data.pending_reports
              ? `${data.pending_reports} ta hisobot kutmoqda. «Hammasini hisoblash» ni bosing: guruhdagi fayllar o'qiladi va kunlar hisoblanadi.`
              : "«Hammasini hisoblash» ni bosing: guruhdagi Excel fayllar o'qiladi va har bir kun hisoblanadi."
          }
          action={
            <Can do="nasiya.review">
              <ProcessButton />
            </Can>
          }
        />
      </Card>
    );
  }
  const t = data.totals;
  const prev = data.previous_totals;
  const amount = (types: string[]) =>
    data.counts.filter((c) => types.includes(c.type)).reduce((s, c) => s + toNum(c.amount), 0);
  const qty = (types: string[]) => data.counts.filter((c) => types.includes(c.type)).reduce((s, c) => s + c.qty, 0);
  const gap = data.previous_date ? daysBetween(data.previous_date, data.report.report_date ?? data.previous_date) : 0;
  const vanished = data.counts.find((c) => c.type === 'vanished_debt');

  return (
    <div className="space-y-6">
      {data.pending_reports > 0 && (
        <Alert tone="warning" title={`${data.pending_reports} ta yangi hisobot tekshirishni kutmoqda`}>
          <Link to="/nasiya?tab=reports" className="font-medium underline">
            Hisobotlarni ochish
          </Link>{' '}
          — tasdiqlanmaguncha nazoratga kirmaydi.
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[13px] text-slate-500">
        <span>
          Hisobot: <Link to={`/nasiya/reports/${data.report.id}`} className="font-medium text-primary-700 hover:underline">{fmtDate(data.report.report_date)}</Link>
        </span>
        {data.previous_date && <span>· taqqoslash: {fmtDate(data.previous_date)}</span>}
        {data.report.reviewed_by && <span>· tasdiqladi: {data.report.reviewed_by}</span>}
      </div>
      {data.report.error_count > 0 && (
        <Alert tone="warning" title={`Bu kun faylida ${fmtQty(data.report.error_count)} ta xato bor`}>
          Kun hisoblandi, lekin xato qatorlar (IMEI, soni, narxi) raqamlarga ta'sir qilishi mumkin.{' '}
          <Link to={`/nasiya/reports/${data.report.id}`} className="font-medium underline">
            Xatolarni ko'rish
          </Link>{' '}
          — Excel'da tuzatib guruhga qayta tashlansa, shu kun o'zi yangilanadi.
        </Alert>
      )}
      {gap > 1 && (
        <Alert tone="info">
          Oldingi tasdiqlangan kun {fmtDate(data.previous_date)} ({gap} kun oldin). Quyidagi o'zgarishlar shu {gap} kunlik
          oraliq uchun: oradagi kunlar tasdiqlansa, aniqroq bo'ladi.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Jami nasiya"
          icon={BanknotesIcon}
          tint="orange"
          value={fmtUsd(t.debt_usd, { symbol: true })}
          sub={
            <>
              {fmtQty(t.debt_qty)} dona
              {toNum(t.variant_usd) > 0 && <> · variant {fmtUsd(t.variant_usd, { symbol: true, decimals: 0 })}</>}
              {prev && (
                <span className={`ml-1 ${signClass(toNum(t.debt_usd) - toNum(prev.debt_usd), true)}`}>
                  ({fmtSignedUsd(toNum(t.debt_usd) - toNum(prev.debt_usd))})
                </span>
              )}
            </>
          }
        />
        <StatCard
          label="To'landi (Sotuv)"
          icon={TrendUpIcon}
          tint="green"
          value={fmtUsd(t.sotuv_usd, { symbol: true })}
          sub={`${fmtQty(t.sotuv_qty)} dona`}
        />
        <StatCard
          label="Yangi nasiya"
          icon={ClipboardCheckIcon}
          tint="blue"
          value={fmtUsd(amount(['new_debt', 'qoldiq_to_debt']), { symbol: true })}
          sub={`${fmtQty(qty(['new_debt', 'qoldiq_to_debt']))} dona · qoldiq ${fmtQty(t.qoldiq_qty)} dona`}
        />
        <StatCard
          label="Ogohlantirishlar"
          icon={WarningIcon}
          tint="red"
          value={fmtQty(data.alerts.length)}
          valueClassName={data.alerts.length ? 'text-danger-600' : 'text-slate-900'}
          sub={vanished ? `izsiz chiqqan nasiya: ${fmtUsd(vanished.amount, { symbol: true })}` : 'muammo topilmadi'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SeriesChart />
        </div>
        <AgingCard aging={data.aging} historyStart={data.history_start} />
      </div>

      <MonthsCard />

      <CustomersCard rows={data.customers} />

      {data.alerts.length > 0 && (
        <Card
          title={`Ogohlantirishlar · ${data.alerts.length}`}
          subtitle="Kutilmagan o'zgarishlar: har birini tekshiring. IMEI ni bossangiz, telefonning butun tarixi chiqadi."
        >
          <EventsTable events={data.alerts} onImei={setTrailImei} />
        </Card>
      )}

      <Card title="Kun davomidagi o'zgarishlar" subtitle="Oldingi tasdiqlangan kun bilan IMEI bo'yicha taqqoslash.">
        {data.counts.length === 0 ? (
          <EmptyState title="O'zgarish yo'q" />
        ) : (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Hodisa</th>
                  <th className="num">Dona</th>
                  <th className="num">Summa ($)</th>
                </tr>
              </thead>
              <tbody>
                {data.counts.map((c) => (
                  <tr key={c.type}>
                    <td>
                      {EVENT_LABELS[c.type]} {c.alert && <Badge tone="danger">tekshiring</Badge>}
                    </td>
                    <td className="num">{fmtQty(c.qty)}</td>
                    <td className="num">{toNum(c.amount) ? fmtUsd(c.amount) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card title="IMEI tarixi" subtitle="Telefon qaysi kuni kimda, qaysi holatda bo'lganini ko'rish." padded>
        <ImeiSearch />
      </Card>
      {trailImei && <ImeiTrailModal imei={trailImei} onClose={() => setTrailImei(null)} />}
    </div>
  );
}

const DEBT_SERIES: Series = { key: 'debt', name: 'Nasiya', ...SERIES_COLORS.orange };
const PAID_SERIES: Series = { key: 'paid', name: "To'landi", ...SERIES_COLORS.green };

function SeriesChart() {
  const query = useQuery({ queryKey: nasiyaKeys.series(90), queryFn: () => getNasiyaSeries(90) });
  return (
    <QueryView query={query} isEmpty={(rows) => rows.length < 2} empty={<SeriesEmpty />}>
      {(rows) => <SeriesChartView rows={rows} />}
    </QueryView>
  );
}

function SeriesEmpty() {
  return (
    <ChartPanel title="Nasiya dinamikasi" subtitle="Kamida ikki kun tasdiqlanganda grafik chiqadi.">
      <div className="h-[220px]" />
    </ChartPanel>
  );
}

function SeriesChartView({ rows }: { rows: NasiyaSeriesPoint[] }) {
  const data = rows.map((r) => ({ date: r.date, label: fmtDate(r.date).slice(0, 5), debt: toNum(r.debt_usd), paid: toNum(r.sotuv_usd) }));
  const last = data[data.length - 1];
  return (
    <ChartPanel
      title="Nasiya dinamikasi"
      subtitle={`So'nggi ${data.length} ta tasdiqlangan kun`}
      legend={
        <>
          <LegendItem series={DEBT_SERIES} value={fmtUsd(last.debt, { decimals: 0 })} unit="$" />
          <LegendItem series={PAID_SERIES} value={fmtUsd(last.paid, { decimals: 0 })} unit="$ oxirgi kun" />
        </>
      }
    >
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...xAxisProps} />
            <YAxis yAxisId="debt" orientation="right" tickFormatter={compactNumber} {...yAxisProps} width={44} />
            <YAxis yAxisId="paid" hide />
            <Tooltip
              cursor={barCursor}
              content={
                <ChartTooltip
                  series={[DEBT_SERIES, PAID_SERIES]}
                  format={(v) => fmtUsd(v, { symbol: true, decimals: 0 })}
                  heading={(label) => label}
                />
              }
            />
            <Bar yAxisId="paid" dataKey="paid" fill={PAID_SERIES.color} radius={BAR_RADIUS} maxBarSize={14} />
            <Line yAxisId="debt" dataKey="debt" stroke={DEBT_SERIES.color} strokeWidth={2.2} dot={false} type="monotone" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartPanel>
  );
}

function AgingCard({ aging, historyStart }: { aging: NasiyaAgingBucket[]; historyStart: string | null }) {
  const max = Math.max(1, ...aging.map((b) => toNum(b.amount)));
  return (
    <Card
      title="Nasiya muddati"
      subtitle={`Telefon nasiyada necha kundan beri turibdi${historyStart ? ` (hisob ${fmtDate(historyStart)} dan)` : ''}.`}
      padded
    >
      <div className="space-y-3">
        {aging.map((b, i) => (
          <div key={b.label}>
            <div className="flex items-baseline justify-between text-[13px]">
              <span className="text-slate-600">{b.label}</span>
              <span className="tabular-nums text-slate-900">
                {fmtUsd(b.amount, { symbol: true, decimals: 0 })} <span className="text-slate-500">· {fmtQty(b.qty)} dona</span>
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${i >= 3 ? 'bg-danger-500' : i === 2 ? 'bg-warning-500' : 'bg-primary-500'}`}
                style={{ width: `${(toNum(b.amount) / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function CustomersCard({ rows }: { rows: NasiyaCustomerRow[] }) {
  const sum = (get: (r: NasiyaCustomerRow) => number) => rows.reduce((s, r) => s + get(r), 0);
  return (
    <Card
      title="Mijozlar bo'yicha"
      subtitle="Nasiya — IMEI lar summasi; «Fayldagi» — varaqning o'z hisobi (farq bo'lsa qizil). «Panel qarzi» — Mijozlar bo'limidagi hisob."
    >
      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <TableWrap>
          <table className="tbl">
            <thead>
              <tr>
                <th>Mijoz</th>
                <th className="num">Nasiya ($)</th>
                <th className="num">Dona</th>
                <th className="num">Fayldagi ($)</th>
                <th className="num">Qoldiq</th>
                <th className="num">To'landi ($)</th>
                <th className="num">Yangi nasiya ($)</th>
                <th className="num">Limit ($)</th>
                <th className="num">Bo'sh limit ($)</th>
                <th className="num">Eng eski</th>
                <th className="num">Panel qarzi ($)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const fileDiff = r.file_nasiya_usd !== null ? toNum(r.totals.nasiya_usd) - toNum(r.file_nasiya_usd) : 0;
                return (
                  <tr key={r.customer.id}>
                    <td className="font-medium">
                      <Link to={`/nasiya/customers/${r.customer.id}`} className="text-primary-700 hover:underline">
                        {r.customer.name}
                      </Link>
                      {r.sheet_name !== r.customer.name && <div className="text-[11px] text-slate-500">varaq: {r.sheet_name}</div>}
                    </td>
                    <td className="num font-semibold">{fmtUsd(r.totals.debt_usd)}</td>
                    <td className="num">{fmtQty(r.totals.debt_qty)}</td>
                    <td className={`num ${Math.abs(fileDiff) >= 0.01 ? 'font-semibold text-danger-600' : 'text-slate-500'}`}
                      title={Math.abs(fileDiff) >= 0.01 ? `IMEI summasi bilan farq: ${fmtSignedUsd(fileDiff)}` : undefined}>
                      {fmtUsd(r.file_nasiya_usd)}
                    </td>
                    <td className="num">
                      {fmtQty(r.totals.qoldiq_qty)}
                      {toNum(r.totals.qoldiq_value_usd) > 0 && (
                        <div className="text-[11px] text-slate-500">{fmtUsd(r.totals.qoldiq_value_usd, { symbol: true, decimals: 0 })}</div>
                      )}
                    </td>
                    <td className="num">{toNum(r.paid_usd) ? fmtUsd(r.paid_usd) : '—'}</td>
                    <td className="num">{toNum(r.new_debt_usd) ? fmtUsd(r.new_debt_usd) : '—'}</td>
                    <td className="num">{fmtUsd(r.limit_usd, { decimals: 0 })}</td>
                    <td className={`num ${r.over_limit ? 'font-semibold text-danger-600' : ''}`}>
                      {fmtUsd(r.available_usd, { decimals: 0 })}
                    </td>
                    <td className="num">{r.max_age_days === null ? '—' : `${r.max_age_days} kun`}</td>
                    <td className="num text-slate-500">{fmtUsd(r.panel_debt_usd)}</td>
                    <td className="whitespace-nowrap">
                      {r.alert_count > 0 && <Badge tone="danger">{r.alert_count} ogoh.</Badge>}{' '}
                      {r.error_count > 0 && <Badge tone="warning">{r.error_count} xato</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Jami: {fmtQty(rows.length)}</td>
                <td className="num">{fmtUsd(sum((r) => toNum(r.totals.debt_usd)))}</td>
                <td className="num">{fmtQty(sum((r) => r.totals.debt_qty))}</td>
                <td className="num">{fmtUsd(sum((r) => toNum(r.file_nasiya_usd)))}</td>
                <td className="num">{fmtQty(sum((r) => r.totals.qoldiq_qty))}</td>
                <td className="num">{fmtUsd(sum((r) => toNum(r.paid_usd)))}</td>
                <td className="num">{fmtUsd(sum((r) => toNum(r.new_debt_usd)))}</td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

export function EventsTable({ events, onImei }: { events: NasiyaEvent[]; onImei: (imei: string) => void }) {
  return (
    <TableWrap>
      <table className="tbl">
        <thead>
          <tr>
            <th>Hodisa</th>
            <th>Mijoz</th>
            <th>Model</th>
            <th>IMEI</th>
            <th className="num">Narx ($)</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={`${e.type}-${e.imei}`}>
              <td>
                <div className={e.alert ? 'font-medium text-danger-700' : ''}>{EVENT_LABELS[e.type]}</div>
                {e.alert && EVENT_HINTS[e.type] && <div className="max-w-xs text-[11px] text-slate-500">{EVENT_HINTS[e.type]}</div>}
              </td>
              <td className="whitespace-nowrap">
                {e.customer?.name ?? e.sheet_name}
                {e.other_customer && <div className="text-[11px] text-slate-500">oldin: {e.other_customer.name}</div>}
              </td>
              <td>{e.model}</td>
              <td className="whitespace-nowrap tabular-nums">
                <button type="button" className="text-primary-700 hover:underline" onClick={() => onImei(e.imei)}>
                  {e.imei}
                </button>
              </td>
              <td className="num">
                {fmtUsd(e.price_usd)}
                {e.type === 'price_changed' && <div className="text-[11px] text-slate-500">oldin {fmtUsd(e.previous_price_usd)}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

// ---- reports list ----
const STATUS_FILTERS: { key: NasiyaStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'Hammasi' },
  { key: 'pending', label: 'Kutilmoqda' },
  { key: 'confirmed', label: 'Tasdiqlangan' },
  { key: 'rejected', label: 'Rad etilgan' },
];

function ReportsView() {
  const [status, setStatus] = useState<NasiyaStatus | 'all'>('all');
  const query = useQuery({
    queryKey: nasiyaKeys.reports(status === 'all' ? undefined : status),
    queryFn: () => listNasiyaReports(status === 'all' ? undefined : status),
  });
  const navigate = useNavigate();
  return (
    <Card title="Kelgan fayllar" subtitle="Guruhdan bot olgan va panelda yuklangan kunlik fayllar. Qatorni bosib tekshiring.">
      <div className="px-4 pt-3">
        <Tabs tabs={STATUS_FILTERS} value={status} onChange={setStatus} />
      </div>
      <QueryView
        query={query}
        isEmpty={(rows) => rows.length === 0}
        empty={<EmptyState title="Fayl yo'q" description="Guruhga kunlik Excel tushganda shu yerda paydo bo'ladi." />}
      >
        {(rows) => (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Sana</th>
                  <th>Holati</th>
                  <th>Fayl</th>
                  <th>Kimdan</th>
                  <th className="num">Nasiya</th>
                  <th className="num">Qoldiq</th>
                  <th className="num">Sotuv</th>
                  <th className="num">Xato</th>
                  <th className="num">Diqqat</th>
                  <th className="num">Bog'lanmagan</th>
                  <th>Kelgan</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="row-link" onClick={() => navigate(`/nasiya/reports/${r.id}`)}>
                    <td className="whitespace-nowrap font-medium">{fmtDate(r.report_date)}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="max-w-[220px] truncate" title={r.file_name}>
                      {r.file_name || '—'}
                    </td>
                    <td className="whitespace-nowrap text-slate-500">
                      {r.sent_by || '—'}
                      <div className="text-[11px]">{r.source === 'telegram' ? r.chat_title || 'Telegram' : 'Panel'}</div>
                    </td>
                    <td className="num">
                      {fmtQty(r.nasiya_qty)} dona
                      <div className="text-[11px] text-slate-500">{fmtUsd(r.nasiya_usd, { symbol: true, decimals: 0 })}</div>
                    </td>
                    <td className="num">{fmtQty(r.qoldiq_qty)} dona</td>
                    <td className="num">
                      {fmtQty(r.sotuv_qty)} dona
                      <div className="text-[11px] text-slate-500">{fmtUsd(r.sotuv_usd, { symbol: true, decimals: 0 })}</div>
                    </td>
                    <td className={`num ${r.error_count ? 'font-semibold text-danger-600' : 'text-slate-400'}`}>{r.error_count}</td>
                    <td className={`num ${r.warning_count ? 'text-warning-700' : 'text-slate-400'}`}>{r.warning_count}</td>
                    <td className={`num ${r.unlinked_sheets ? 'font-semibold text-warning-700' : 'text-slate-400'}`}>
                      {r.unlinked_sheets}
                    </td>
                    <td className="whitespace-nowrap text-slate-500">{fmtDateTime(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </QueryView>
    </Card>
  );
}

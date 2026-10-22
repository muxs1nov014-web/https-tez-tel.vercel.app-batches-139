import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getNasiyaPhones, nasiyaKeys, type NasiyaPhoneGroup, type NasiyaPhoneRow } from '../../api/nasiya';
import { Button } from '../../components/ui/Button';
import { Card, TableWrap } from '../../components/ui/Card';
import { ChevronDownIcon, ChevronRightIcon } from '../../components/ui/icons';
import { Select } from '../../components/ui/Input';
import { SearchField } from '../../components/ui/SearchField';
import { EmptyState, QueryView } from '../../components/ui/States';
import { Tabs } from '../../components/ui/Tabs';
import { fmtDate, fmtQty, fmtUsd, toNum } from '../../lib/format';
import { AgeBadge, debtAgeClass, ImeiTrailModal, KindBadge } from './shared';

type GroupKey = 'all' | NasiyaPhoneGroup;
const GROUPS: { key: GroupKey; label: string }[] = [
  { key: 'all', label: 'Hammasi' },
  { key: 'debt', label: 'Nasiya' },
  { key: 'qoldiq', label: 'Qoldiq' },
  { key: 'sotuv', label: 'Sotuv' },
];
/** IMEIs shown in a line before "+N". */
const IMEIS_SHOWN = 6;

/** Every phone of the latest counted day per customer: nasiya, then qoldiq with their days, then sotuv. */
export function NasiyaPhonesView() {
  const [group, setGroup] = useState<GroupKey>('all');
  const apiGroup = group === 'all' ? undefined : group;
  const query = useQuery({ queryKey: nasiyaKeys.phones(apiGroup), queryFn: () => getNasiyaPhones(apiGroup) });
  return (
    <div className="space-y-4">
      <Tabs tabs={GROUPS} value={group} onChange={setGroup} />
      <QueryView query={query}>
        {(data) =>
          data.report ? (
            <PhonesTable rows={data.rows} day={data.report.report_date} historyStart={data.history_start} />
          ) : (
            <Card>
              <EmptyState title="Hali hisoblangan kun yo'q" />
            </Card>
          )
        }
      </QueryView>
    </div>
  );
}

type Totals = {
  debtQty: number;
  debtUsd: number;
  qoldiqQty: number;
  sotuvQty: number;
  sotuvUsd: number;
  soldBack: number;
  /** Nasiya exactly 2 days old / more than 2 days old: [qty, usd]. */
  twoDays: [number, number];
  overTwo: [number, number];
};

/** The day the business watches: phones exactly 2 days in nasiya, and those past it. */
const WATCH_DAY = 2;

/** Phones with the same state, model, days, price and term: one line with their IMEIs. */
type Line = { key: string; first: NasiyaPhoneRow; qty: number; imeis: string[] };

type CustomerGroup = Totals & {
  key: string;
  name: string;
  customerId: number | null;
  lines: Line[];
  oldestDebt: NasiyaPhoneRow | null;
};

const isDebt = (r: NasiyaPhoneRow) => r.kind === 'nasiya' || r.kind === 'variant';

function addTo(t: Totals, r: NasiyaPhoneRow) {
  const amount = toNum(r.price_usd) * r.qty;
  if (r.kind === 'qoldiq') t.qoldiqQty += r.qty;
  else if (r.kind === 'sotuv') {
    t.sotuvQty += r.qty;
    t.sotuvUsd += amount;
  } else {
    t.debtQty += r.qty;
    t.debtUsd += amount;
    const bucket = r.age_days === WATCH_DAY ? t.twoDays : r.age_days !== null && r.age_days > WATCH_DAY ? t.overTwo : null;
    if (bucket) {
      bucket[0] += r.qty;
      bucket[1] += amount;
    }
  }
  if (r.sold_on) t.soldBack += r.qty;
}

const emptyTotals = (): Totals => ({
  debtQty: 0,
  debtUsd: 0,
  qoldiqQty: 0,
  sotuvQty: 0,
  sotuvUsd: 0,
  soldBack: 0,
  twoDays: [0, 0],
  overTwo: [0, 0],
});

const money = (usd: number) => fmtUsd(usd, { symbol: true, decimals: 0 });

/** The whole list: nasiya exactly 2 days old, and nasiya older than 2 days. */
function DebtSummary({ t }: { t: Totals }) {
  if (t.debtQty === 0) return null;
  const tiles = [
    { label: `${WATCH_DAY} kun bo'lgan nasiya`, v: t.twoDays, tone: 'text-slate-900', bar: 'bg-yellow-300' },
    { label: `${WATCH_DAY} kundan oshgan nasiya`, v: t.overTwo, tone: 'text-danger-700', bar: 'bg-danger-600' },
  ];
  return (
    <div className="grid grid-cols-1 gap-2 px-4 pb-3 sm:grid-cols-2 sm:px-5">
      {tiles.map((x) => (
        <div key={x.label} className="relative overflow-hidden rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
          <span className={`absolute inset-y-0 left-0 w-1 ${x.bar}`} />
          <div className="text-[12px] text-slate-500">{x.label}</div>
          <div className={`text-[20px] font-semibold tabular-nums ${x.tone}`}>{money(x.v[1])}</div>
          <div className="text-[12px] text-slate-500">{fmtQty(x.v[0])} dona</div>
        </div>
      ))}
    </div>
  );
}

/** Under a customer's name: its nasiya exactly 2 days old and older than 2 days. */
function DebtSplit({ t }: { t: Totals }) {
  if (t.twoDays[0] === 0 && t.overTwo[0] === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-2.5 pl-10 text-[12px] sm:px-5 sm:pl-11">
      {t.twoDays[0] > 0 && (
        <span className={`rounded-full px-2 py-0.5 font-medium ${debtAgeClass(0)}`}>
          {WATCH_DAY} kun bo'lgan: {fmtQty(t.twoDays[0])} dona · {money(t.twoDays[1])}
        </span>
      )}
      {t.overTwo[0] > 0 && (
        <span className={`rounded-full px-2 py-0.5 font-semibold ${debtAgeClass(5)}`}>
          {WATCH_DAY} kundan oshgan: {fmtQty(t.overTwo[0])} dona · {money(t.overTwo[1])}
        </span>
      )}
    </div>
  );
}

function PhonesTable({ rows, day, historyStart }: { rows: NasiyaPhoneRow[]; day: string | null; historyStart: string | null }) {
  const [search, setSearch] = useState('');
  const [customer, setCustomer] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [trailImei, setTrailImei] = useState<string | null>(null);

  const customers = useMemo(() => {
    const names = new Map<string, string>();
    for (const r of rows) names.set(String(r.customer?.id ?? r.sheet_name), r.customer?.name ?? r.sheet_name);
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!customer || String(r.customer?.id ?? r.sheet_name) === customer) &&
        (!q || (r.imei ?? '').includes(q) || r.model.toLowerCase().includes(q)),
    );
  }, [rows, search, customer]);
  const { groups, totals } = useMemo(() => {
    const all = emptyTotals();
    const byKey = new Map<string, CustomerGroup>();
    const lines = new Map<string, Line>();
    for (const r of filtered) {
      const key = String(r.customer?.id ?? r.sheet_name);
      let g = byKey.get(key);
      if (!g) {
        g = { ...emptyTotals(), key, name: r.customer?.name ?? r.sheet_name, customerId: r.customer?.id ?? null, lines: [], oldestDebt: null };
        byKey.set(key, g);
      }
      addTo(g, r);
      addTo(all, r);
      if (isDebt(r) && r.age_days !== null && (g.oldestDebt === null || r.age_days > (g.oldestDebt.age_days ?? -1))) g.oldestDebt = r;
      const lineKey = [key, r.kind, r.model, r.age_days, r.since_exact, r.overdue, r.price_usd, r.term_days, r.sold_on].join('|');
      let line = lines.get(lineKey);
      if (!line) {
        line = { key: lineKey, first: r, qty: 0, imeis: [] };
        lines.set(lineKey, line);
        g.lines.push(line);
      }
      line.qty += r.qty;
      if (r.imei) line.imeis.push(r.imei);
    }
    return { groups: [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name)), totals: all };
  }, [filtered]);

  // a chosen customer or a search shows the phones at once; otherwise each customer is one line until opened
  const focused = customer !== '' || search.trim() !== '';
  const isOpen = (key: string) => focused || open.has(key);
  const allOpen = groups.length > 0 && groups.every((g) => isOpen(g.key));
  const toggle = (key: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Card
      title={`Telefonlar · ${fmtDate(day)}`}
      subtitle={
        'Har bir mijoz alohida: nasiya, qoldiq (necha kundan beri turibdi) va sotuv. Mijoz nomini bosing — telefonlari ochiladi.' +
        (historyStart ? ` Hisob ${fmtDate(historyStart)} dan: «≥» — undan oldin ham bo'lgan.` : '')
      }
      actions={
        <>
          <div className="w-48">
            <Select value={customer} onChange={(e) => setCustomer(e.target.value)}>
              <option value="">Barcha mijozlar</option>
              {customers.map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
          <SearchField value={search} onChange={setSearch} placeholder="IMEI yoki model…" className="w-56" />
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pb-3 text-[13px] text-slate-600 sm:px-5">
        <TotalsLine t={totals} />
        {groups.length > 0 && !focused && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map((g) => g.key)))}>
            {allOpen ? "Hammasini yig'ish" : 'Hammasini ochish'}
          </Button>
        )}
      </div>
      <DebtSummary t={totals} />
      {groups.length === 0 ? (
        <EmptyState title="Topilmadi" />
      ) : (
        <div className="divide-y divide-slate-200 border-t border-slate-200 dark:divide-white/10 dark:border-white/10">
          {groups.map((g) => (
            <CustomerPhones key={g.key} group={g} open={isOpen(g.key)} onToggle={() => toggle(g.key)} onImei={setTrailImei} />
          ))}
        </div>
      )}
      {trailImei && <ImeiTrailModal imei={trailImei} onClose={() => setTrailImei(null)} />}
    </Card>
  );
}

function TotalsLine({ t }: { t: Totals }) {
  return (
    <>
      {t.debtQty > 0 && (
        <span>
          Nasiya <span className="font-medium text-slate-900">{fmtQty(t.debtQty)}</span> ·{' '}
          <span className="font-medium text-slate-900">{money(t.debtUsd)}</span>
        </span>
      )}
      {t.qoldiqQty > 0 && (
        <span>
          Qoldiq <span className="font-medium text-slate-900">{fmtQty(t.qoldiqQty)}</span>
        </span>
      )}
      {t.sotuvQty > 0 && (
        <span>
          Sotuv <span className="font-medium text-slate-900">{fmtQty(t.sotuvQty)}</span>
          {t.sotuvUsd > 0 && <> · {fmtUsd(t.sotuvUsd, { symbol: true, decimals: 0 })}</>}
        </span>
      )}
      {t.soldBack > 0 && (
        <span className="rounded-full bg-danger-600 px-2 py-0.5 text-[11.5px] font-medium text-white">
          {fmtQty(t.soldBack)} ta sotilgan telefon qaytgan
        </span>
      )}
    </>
  );
}

/** One customer: a single summary line; opened, its phones in compact lines (same model and days together). */
function CustomerPhones({
  group: g,
  open,
  onToggle,
  onImei,
}: {
  group: CustomerGroup;
  open: boolean;
  onToggle: () => void;
  onImei: (imei: string) => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[13px] text-slate-600 sm:px-5">
        <button type="button" onClick={onToggle} className="flex min-w-[11rem] items-center gap-1.5 text-left font-semibold text-slate-900">
          {open ? <ChevronDownIcon className="h-4 w-4 shrink-0" /> : <ChevronRightIcon className="h-4 w-4 shrink-0" />}
          {g.name}
        </button>
        {g.oldestDebt && (
          <AgeBadge days={g.oldestDebt.age_days} exact={g.oldestDebt.since_exact} overdue={g.oldestDebt.overdue} kind="nasiya" />
        )}
        <TotalsLine t={g} />
        {g.customerId !== null && (
          <Link to={`/nasiya/customers/${g.customerId}`} className="ml-auto text-[12px] text-primary-700 hover:underline">
            Mijoz sahifasi →
          </Link>
        )}
      </div>
      <DebtSplit t={g} />
      {open && (
        <TableWrap className="mx-4 mb-3 sm:mx-5">
          <table className="tbl">
            <thead>
              <tr>
                <th>Kun</th>
                <th>Holati</th>
                <th>Model</th>
                <th className="num">Soni</th>
                <th>IMEI</th>
                <th className="num">Narx</th>
              </tr>
            </thead>
            <tbody>
              {g.lines.map((line) => (
                <PhoneLine key={line.key} line={line} onImei={onImei} />
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </div>
  );
}

function PhoneLine({ line, onImei }: { line: Line; onImei: (imei: string) => void }) {
  const [all, setAll] = useState(false);
  const r = line.first;
  const shown = all ? line.imeis : line.imeis.slice(0, IMEIS_SHOWN);
  return (
    <tr className={r.sold_on ? 'bg-danger-50' : undefined}>
      <td className="whitespace-nowrap">
        {r.kind === 'sotuv' ? (
          <span className="text-slate-300">—</span>
        ) : (
          <>
            <AgeBadge days={r.age_days} exact={r.since_exact} overdue={r.overdue} kind={r.kind} />
            {r.since && <div className="mt-0.5 text-[11px] text-slate-500">{fmtDate(r.since)} dan</div>}
          </>
        )}
      </td>
      <td>
        <KindBadge kind={r.kind} />
        {r.sold_on && <div className="mt-0.5 text-[11px] font-medium text-danger-700">sotilgan {fmtDate(r.sold_on)}!</div>}
      </td>
      <td className="whitespace-nowrap font-medium">{r.model}</td>
      <td className="num">{fmtQty(line.qty)}</td>
      <td>
        <div className="flex max-w-xl flex-wrap gap-x-2 gap-y-0.5 text-[12px] tabular-nums">
          {shown.map((imei) => (
            <button key={imei} type="button" className="text-primary-700 hover:underline" onClick={() => onImei(imei)}>
              {imei}
            </button>
          ))}
          {line.imeis.length > IMEIS_SHOWN && (
            <button type="button" className="font-medium text-slate-500 hover:text-slate-800" onClick={() => setAll((v) => !v)}>
              {all ? 'yig\'ish' : `+${line.imeis.length - IMEIS_SHOWN} ta`}
            </button>
          )}
          {line.imeis.length === 0 && <span className="text-slate-400">IMEI yo'q</span>}
        </div>
      </td>
      <td className="num whitespace-nowrap">
        {r.price_usd != null ? fmtUsd(r.price_usd, { symbol: true, decimals: 0 }) : '—'}
        {r.term_days != null && <div className="text-[11px] text-slate-500">{r.term_days} kun muddat</div>}
      </td>
    </tr>
  );
}

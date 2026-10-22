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

/** Nasiya by days, like the colours: up to 2 days, 3–4, from 5. */
const AGE_BANDS = [
  { label: '2 kungacha', sample: 0, test: (d: number) => d <= 2 },
  { label: '3–4 kun', sample: 3, test: (d: number) => d > 2 && d < 5 },
  { label: '5 kundan', sample: 5, test: (d: number) => d >= 5 },
];

type Totals = {
  debtQty: number;
  debtUsd: number;
  qoldiqQty: number;
  sotuvQty: number;
  sotuvUsd: number;
  soldBack: number;
  /** Nasiya per AGE_BANDS entry: [qty, usd]. */
  bands: [number, number][];
};

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
    const band = r.age_days === null ? -1 : AGE_BANDS.findIndex((b) => b.test(r.age_days as number));
    if (band >= 0) {
      t.bands[band][0] += r.qty;
      t.bands[band][1] += amount;
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
  bands: AGE_BANDS.map(() => [0, 0]),
});

const money = (usd: number) => fmtUsd(usd, { symbol: true, decimals: 0 });

/** Nasiya older than 2 days: the bands after the first. */
function overTwo(t: Totals): [number, number] {
  return t.bands.slice(1).reduce<[number, number]>((s, [q, u]) => [s[0] + q, s[1] + u], [0, 0]);
}

/** Nasiya per day band in its colour, and everything older than 2 days together: for the whole list, and for each
 *  customer on its own under its name. */
function AgeBands({ t, small = false }: { t: Totals; small?: boolean }) {
  if (t.debtQty === 0) return null;
  const [lateQty, lateUsd] = overTwo(t);
  const chip = small ? 'rounded-full px-2 py-0.5' : 'rounded-full px-2.5 py-1';
  return (
    <div
      className={`flex flex-wrap items-center gap-2 px-4 sm:px-5 ${small ? 'pb-2.5 pl-10 text-[12px] sm:pl-11' : 'pb-3 text-[13px]'}`}
    >
      {!small && <span className="text-slate-600">Nasiya kunlari:</span>}
      {AGE_BANDS.map((b, i) =>
        small && t.bands[i][0] === 0 ? null : (
          <span key={b.label} className={`${chip} font-medium ${debtAgeClass(b.sample)}`}>
            {b.label}: {fmtQty(t.bands[i][0])} dona · {money(t.bands[i][1])}
          </span>
        ),
      )}
      <span className={`${chip} font-semibold text-danger-700 ring-1 ring-danger-200`}>
        2 kundan ko'p jami: {fmtQty(lateQty)} dona · {money(lateUsd)}
      </span>
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
      <AgeBands t={totals} />
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
      <AgeBands t={g} small />
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

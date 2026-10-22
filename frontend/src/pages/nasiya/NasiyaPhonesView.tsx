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
  { key: 'all', label: 'Nasiya + qoldiq' },
  { key: 'debt', label: 'Nasiya' },
  { key: 'qoldiq', label: 'Qoldiq' },
];
const PAGE = 300;

/** Every nasiya and qoldiq phone of the latest counted day with how many days it has been there, oldest first. */
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

function PhonesTable({ rows, day, historyStart }: { rows: NasiyaPhoneRow[]; day: string | null; historyStart: string | null }) {
  const [search, setSearch] = useState('');
  const [customer, setCustomer] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
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
  const groups = useMemo(() => {
    const byKey = new Map<string, CustomerGroup>();
    for (const r of filtered) {
      const key = String(r.customer?.id ?? r.sheet_name);
      let g = byKey.get(key);
      if (!g) {
        g = { key, name: r.customer?.name ?? r.sheet_name, customerId: r.customer?.id ?? null, rows: [], debtQty: 0,
          debtUsd: 0, qoldiqQty: 0, oldestDebt: null };
        byKey.set(key, g);
      }
      g.rows.push(r);
      if (r.kind === 'qoldiq') g.qoldiqQty += r.qty;
      else {
        g.debtQty += r.qty;
        g.debtUsd += toNum(r.price_usd) * r.qty;
        if (r.age_days !== null && (g.oldestDebt === null || r.age_days > (g.oldestDebt.age_days ?? -1))) g.oldestDebt = r;
      }
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered]);
  const allClosed = groups.length > 0 && groups.every((g) => closed.has(g.key));
  const qty = filtered.reduce((s, r) => s + r.qty, 0);
  const amount = filtered.reduce((s, r) => s + (r.kind === 'qoldiq' ? 0 : toNum(r.price_usd) * r.qty), 0);
  const over = (days: number) => filtered.filter((r) => (r.age_days ?? 0) > days).reduce((s, r) => s + r.qty, 0);

  return (
    <Card
      title={`Telefonlar · ${fmtDate(day)}`}
      subtitle={
        `Har bir telefon shu mijozda shu holatda necha kundan beri turibdi (eng uzog'i tepada).` +
        (historyStart ? ` Hisob ${fmtDate(historyStart)} dan boshlangan: «≥» — undan oldin ham bo'lgan.` : '')
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
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3 text-[13px] text-slate-600 sm:px-5">
        <span>
          Jami: <span className="font-medium text-slate-900">{fmtQty(qty)} dona</span>
          {amount > 0 && <> · nasiya {fmtUsd(amount, { symbol: true, decimals: 0 })}</>}
        </span>
        <span>7 kundan ko'p: <span className="font-medium text-warning-700">{fmtQty(over(7))}</span></span>
        <span>30 kundan ko'p: <span className="font-medium text-danger-600">{fmtQty(over(30))}</span></span>
        <span className="flex items-center gap-1.5">
          Nasiya:
          <span className={`rounded-full px-1.5 text-[11px] ${debtAgeClass(0)}`}>2 kungacha</span>
          <span className={`rounded-full px-1.5 text-[11px] ${debtAgeClass(3)}`}>3–4 kun</span>
          <span className={`rounded-full px-1.5 text-[11px] ${debtAgeClass(5)}`}>5 kundan</span>
        </span>
      </div>
      {groups.length === 0 ? (
        <EmptyState title="Topilmadi" />
      ) : (
        <>
          <div className="flex justify-end px-4 pb-2 sm:px-5">
            <Button size="sm" variant="ghost" onClick={() => setClosed(allClosed ? new Set() : new Set(groups.map((g) => g.key)))}>
              {allClosed ? 'Hammasini ochish' : "Hammasini yig'ish"}
            </Button>
          </div>
          <div className="space-y-3 px-4 pb-4 sm:px-5">
            {groups.map((g) => (
              <CustomerPhones
                key={g.key}
                group={g}
                open={!closed.has(g.key)}
                onToggle={() =>
                  setClosed((s) => {
                    const next = new Set(s);
                    if (next.has(g.key)) next.delete(g.key);
                    else next.add(g.key);
                    return next;
                  })
                }
                onImei={setTrailImei}
              />
            ))}
          </div>
        </>
      )}
      {trailImei && <ImeiTrailModal imei={trailImei} onClose={() => setTrailImei(null)} />}
    </Card>
  );
}

type CustomerGroup = {
  key: string;
  name: string;
  customerId: number | null;
  rows: NasiyaPhoneRow[];
  debtQty: number;
  debtUsd: number;
  qoldiqQty: number;
  oldestDebt: NasiyaPhoneRow | null;
};

/** One customer's phones in their own block: totals and the oldest nasiya in the header, oldest phone first. */
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
  const [limit, setLimit] = useState(PAGE);
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-slate-200 dark:ring-white/10">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-slate-50 px-3 py-2.5 text-[13px] dark:bg-white/5">
        <button type="button" onClick={onToggle} className="flex items-center gap-1.5 font-semibold text-slate-900">
          {open ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
          {g.name}
        </button>
        {g.customerId !== null && (
          <Link to={`/nasiya/customers/${g.customerId}`} className="text-[12px] text-primary-700 hover:underline">
            mijoz sahifasi
          </Link>
        )}
        <span className="text-slate-600">
          Nasiya: <span className="font-medium text-slate-900">{fmtQty(g.debtQty)} dona</span>
          {g.debtUsd > 0 && <> · {fmtUsd(g.debtUsd, { symbol: true, decimals: 0 })}</>}
        </span>
        <span className="text-slate-600">
          Qoldiq: <span className="font-medium text-slate-900">{fmtQty(g.qoldiqQty)} dona</span>
        </span>
        {g.oldestDebt && (
          <span className="flex items-center gap-1.5 text-slate-600">
            Eng uzoq nasiya:
            <AgeBadge days={g.oldestDebt.age_days} exact={g.oldestDebt.since_exact} overdue={g.oldestDebt.overdue} kind="nasiya" />
          </span>
        )}
      </div>
      {open && (
        <TableWrap>
          <table className="tbl">
            <thead>
              <tr>
                <th>Necha kun</th>
                <th>Qachondan</th>
                <th>Holati</th>
                <th>Model</th>
                <th>IMEI</th>
                <th className="num">Narx</th>
                <th className="num">Muddat</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.slice(0, limit).map((r, i) => (
                <tr key={`${r.imei ?? r.model}-${i}`}>
                  <td>
                    <AgeBadge days={r.age_days} exact={r.since_exact} overdue={r.overdue} kind={r.kind} />
                  </td>
                  <td className="whitespace-nowrap text-slate-500">{r.since ? fmtDate(r.since) : '—'}</td>
                  <td>
                    <KindBadge kind={r.kind} />
                  </td>
                  <td className="whitespace-nowrap">{r.model}</td>
                  <td className="whitespace-nowrap tabular-nums">
                    {r.imei ? (
                      <button type="button" className="text-primary-700 hover:underline" onClick={() => onImei(r.imei!)}>
                        {r.imei}
                      </button>
                    ) : (
                      <span className="text-slate-400">{fmtQty(r.qty)} dona</span>
                    )}
                  </td>
                  <td className="num">{r.price_usd != null ? fmtUsd(r.price_usd, { symbol: true, decimals: 0 }) : '—'}</td>
                  <td className="num">{r.term_days != null ? `${r.term_days} kun` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {open && g.rows.length > limit && (
        <div className="p-3 text-center">
          <Button size="sm" onClick={() => setLimit((n) => n + PAGE)}>
            Yana {fmtQty(Math.min(PAGE, g.rows.length - limit))} ta ko'rsatish ({fmtQty(g.rows.length - limit)} qoldi)
          </Button>
        </div>
      )}
    </div>
  );
}

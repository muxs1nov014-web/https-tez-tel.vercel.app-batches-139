import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getNasiyaPhones, nasiyaKeys, type NasiyaPhoneGroup, type NasiyaPhoneRow } from '../../api/nasiya';
import { Button } from '../../components/ui/Button';
import { Card, TableWrap } from '../../components/ui/Card';
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
  const [limit, setLimit] = useState(PAGE);
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
      {filtered.length === 0 ? (
        <EmptyState title="Topilmadi" />
      ) : (
        <TableWrap>
          <table className="tbl">
            <thead>
              <tr>
                <th>Necha kun</th>
                <th>Qachondan</th>
                <th>Mijoz</th>
                <th>Holati</th>
                <th>Model</th>
                <th>IMEI</th>
                <th className="num">Narx</th>
                <th className="num">Muddat</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, limit).map((r, i) => (
                <tr key={`${r.imei ?? r.model}-${i}`}>
                  <td>
                    <AgeBadge days={r.age_days} exact={r.since_exact} overdue={r.overdue} kind={r.kind} />
                  </td>
                  <td className="whitespace-nowrap text-slate-500">{r.since ? fmtDate(r.since) : '—'}</td>
                  <td className="whitespace-nowrap">
                    {r.customer ? (
                      <Link to={`/nasiya/customers/${r.customer.id}`} className="text-primary-700 hover:underline">
                        {r.customer.name}
                      </Link>
                    ) : (
                      r.sheet_name
                    )}
                  </td>
                  <td>
                    <KindBadge kind={r.kind} />
                  </td>
                  <td className="whitespace-nowrap">{r.model}</td>
                  <td className="whitespace-nowrap tabular-nums">
                    {r.imei ? (
                      <button type="button" className="text-primary-700 hover:underline" onClick={() => setTrailImei(r.imei)}>
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
      {filtered.length > limit && (
        <div className="p-3 text-center">
          <Button size="sm" onClick={() => setLimit((n) => n + PAGE)}>
            Yana {fmtQty(Math.min(PAGE, filtered.length - limit))} ta ko'rsatish ({fmtQty(filtered.length - limit)} qoldi)
          </Button>
        </div>
      )}
      {trailImei && <ImeiTrailModal imei={trailImei} onClose={() => setTrailImei(null)} />}
    </Card>
  );
}

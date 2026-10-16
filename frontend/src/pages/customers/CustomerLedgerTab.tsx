import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  customerAccountKeys,
  getCustomerLedger,
  type CustomerTotals,
  type LedgerEntryType,
} from '../../api/customerAccounts';
import type { Num } from '../../api/types';
import { Badge, type Tone } from '../../components/ui/Badge';
import { Card, TableWrap } from '../../components/ui/Card';
import { ListRow, ListSection } from '../../components/ui/List';
import { EmptyState, LoadingState, QueryView } from '../../components/ui/States';
import { LEDGER_TYPE_LABELS } from '../../lib/categories';
import { fmtDate, fmtUsd, signClass, toNum } from '../../lib/format';

const TYPE_TONES: Record<LedgerEntryType, Tone> = {
  opening_debt: 'warning',
  sale: 'primary',
  service: 'slate',
  payment: 'success',
};

interface CustomerLedgerTabProps {
  customerId: number;
  totals: CustomerTotals;
  debt: Num;
}

/** Chronological debt ledger with a running balance. */
export function CustomerLedgerTab({ customerId, totals, debt }: CustomerLedgerTabProps) {
  const query = useQuery({
    queryKey: customerAccountKeys.ledger(customerId),
    queryFn: () => getCustomerLedger(customerId),
  });

  const parts: { label: string; value: Num; sign: string; className?: string }[] = [
    { label: "Boshlang'ich qarz", value: totals.opening_debt, sign: '' },
    { label: 'Sotuvlar', value: totals.charged_sales, sign: '+' },
    { label: 'Xizmat haqi', value: totals.charged_service, sign: '+' },
    { label: "To'langan", value: totals.paid, sign: '−' },
    { label: 'Nasiya', value: debt, sign: '=', className: `font-semibold ${signClass(debt, true)}` },
  ];

  const note =
    "Debet qarzni oshiradi (boshlang'ich qarz, sotuv, xizmat haqi), kredit kamaytiradi (to'lov). Qoldiq — shu yozuvdan keyingi nasiya.";
  const empty = (
    <EmptyState
      title="Hisob-kitob yozuvlari yo'q"
      description="Sotuv, to'lov yoki boshlang'ich qarz kiritilgach, shu yerda sana bo'yicha ko'rinadi."
    />
  );

  return (
    <>
      {/* iPhone: the debt breakdown as a receipt, then the entries oldest first with the running balance */}
      <div className="space-y-6 md:hidden">
        <ListSection header="Hisob-kitob">
          {parts.map((p) => (
            <ListRow
              key={p.label}
              title={
                <>
                  <span className="mr-1.5 inline-block w-3 text-center text-slate-400">{p.sign}</span>
                  {p.label}
                </>
              }
              value={<span className={p.className ?? 'text-slate-900'}>{fmtUsd(p.value, { symbol: true })}</span>}
            />
          ))}
        </ListSection>
        <QueryView query={query} isEmpty={(rows) => rows.length === 0} empty={empty} loading={<LoadingState />}>
          {(rows) => {
            const debit = rows.reduce((s, r) => s + toNum(r.debit), 0);
            const credit = rows.reduce((s, r) => s + toNum(r.credit), 0);
            return (
              <ListSection
                header="Yozuvlar"
                footer={
                  <>
                    Jami: debet {fmtUsd(debit, { symbol: true })} · kredit {fmtUsd(credit, { symbol: true })}. {note}
                  </>
                }
              >
                {rows.map((r, i) => {
                  const isCredit = toNum(r.credit) !== 0;
                  return (
                    <ListRow
                      key={`${r.type}-${r.ref_id ?? 'x'}-${i}`}
                      to={r.type === 'sale' && r.ref_id !== null ? `/sales/${r.ref_id}` : undefined}
                      title={r.description}
                      subtitle={`${fmtDate(r.date)} · ${LEDGER_TYPE_LABELS[r.type]}`}
                      value={
                        <span className={isCredit ? 'text-success-700' : 'text-slate-900'}>
                          {isCredit ? `−${fmtUsd(r.credit)}` : `+${fmtUsd(r.debit)}`}
                        </span>
                      }
                      valueStrong
                      valueSub={`qoldiq ${fmtUsd(r.balance)}`}
                    />
                  );
                })}
              </ListSection>
            );
          }}
        </QueryView>
      </div>

      <Card className="hidden md:block" title="Hisob-kitob" subtitle={note}>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-t-[18px] border-b border-slate-200 bg-slate-200 sm:grid-cols-5">
          {parts.map((p, i) => (
            <div key={p.label} className={`bg-surface px-4 py-2.5 ${i === parts.length - 1 ? 'col-span-2 sm:col-span-1' : ''}`}>
              <dt className="text-[12px] font-medium text-slate-500">
                {p.sign && <span className="mr-1 text-slate-400">{p.sign}</span>}
                {p.label}
              </dt>
              <dd className={`mt-0.5 tabular-nums ${p.className ?? 'text-slate-900'}`}>{fmtUsd(p.value, { symbol: true })}</dd>
            </div>
          ))}
        </dl>
        <QueryView query={query} isEmpty={(rows) => rows.length === 0} empty={empty}>
          {(rows) => {
            const debit = rows.reduce((s, r) => s + toNum(r.debit), 0);
            const credit = rows.reduce((s, r) => s + toNum(r.credit), 0);
            const last = rows[rows.length - 1];
            return (
              <TableWrap>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Sana</th>
                      <th>Turi</th>
                      <th>Tavsif</th>
                      <th className="num">Debet ($)</th>
                      <th className="num">Kredit ($)</th>
                      <th className="num">Qoldiq ($)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={`${r.type}-${r.ref_id ?? 'x'}-${i}`}>
                        <td className="whitespace-nowrap">{fmtDate(r.date)}</td>
                        <td>
                          <Badge tone={TYPE_TONES[r.type]}>{LEDGER_TYPE_LABELS[r.type]}</Badge>
                        </td>
                        <td className="min-w-[12rem]">
                          {r.type === 'sale' && r.ref_id !== null ? (
                            <Link to={`/sales/${r.ref_id}`} className="text-primary-700 hover:underline">
                              {r.description}
                            </Link>
                          ) : (
                            r.description
                          )}
                        </td>
                        <td className="num">{toNum(r.debit) !== 0 ? fmtUsd(r.debit) : <span className="text-slate-300">—</span>}</td>
                        <td className="num">
                          {toNum(r.credit) !== 0 ? fmtUsd(r.credit) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className={`num font-medium ${signClass(r.balance, true)}`}>{fmtUsd(r.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>Jami</td>
                      <td className="num">{fmtUsd(debit)}</td>
                      <td className="num">{fmtUsd(credit)}</td>
                      <td className={`num ${signClass(last?.balance, true)}`}>{fmtUsd(last?.balance)}</td>
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

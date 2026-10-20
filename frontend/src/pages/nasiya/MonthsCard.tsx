import { useQuery } from '@tanstack/react-query';
import { getNasiyaMonths, nasiyaKeys } from '../../api/nasiya';
import { Card, TableWrap } from '../../components/ui/Card';
import { QueryView } from '../../components/ui/States';
import { fmtDate, fmtMonth, fmtQty, fmtUsd } from '../../lib/format';

/** Month by month from the confirmed days of the group's Excel (SPEC §18.4): sold, new debt, month-end debt and qoldiq. */
export function MonthsCard({ customerId }: { customerId?: number }) {
  const query = useQuery({ queryKey: nasiyaKeys.months(customerId), queryFn: () => getNasiyaMonths(customerId) });
  return (
    <Card
      title="Oylar kesimida (guruh hisoboti)"
      subtitle="Sotuv — Sotuv ustunidagi telefonlar, har bir IMEI bir marta. Oy oxiri — oyning oxirgi tasdiqlangan kuni."
    >
      <QueryView query={query} isEmpty={(rows) => rows.length === 0} empty={<p className="p-4 text-sm text-slate-500">Hali tasdiqlangan kun yo'q.</p>}>
        {(rows) => (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Oy</th>
                  <th className="num">Kunlar</th>
                  <th className="num">Sotuv (to'landi)</th>
                  <th className="num">Yangi nasiya</th>
                  <th className="num">Oy oxiri nasiya</th>
                  <th className="num">Oy oxiri qoldiq</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.month}>
                    <td className="font-medium">
                      {fmtMonth(m.month, true)}
                      <div className="text-[11px] font-normal text-slate-500">
                        {fmtDate(m.first_date)} – {fmtDate(m.last_date)}
                      </div>
                    </td>
                    <td className="num">{fmtQty(m.days)}</td>
                    <td className="num">
                      {fmtUsd(m.sotuv_usd, { symbol: true })}
                      <div className="text-[11px] font-normal text-slate-500">{fmtQty(m.sotuv_qty)} dona</div>
                    </td>
                    <td className="num">
                      {fmtUsd(m.new_debt_usd, { symbol: true })}
                      <div className="text-[11px] font-normal text-slate-500">
                        {fmtQty(m.new_debt_qty)} dona
                        {m.partial && <span title={`${fmtDate(m.first_date)} — birinchi kun: undan oldingi kun yo'q`}> · {fmtDate(m.first_date)} dan keyin</span>}
                      </div>
                    </td>
                    <td className="num">
                      {fmtUsd(m.debt_usd_end, { symbol: true })}
                      <div className="text-[11px] font-normal text-slate-500">{fmtQty(m.debt_qty_end)} dona</div>
                    </td>
                    <td className="num">{fmtQty(m.qoldiq_qty_end)} dona</td>
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

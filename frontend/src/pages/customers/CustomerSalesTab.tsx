import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { customerAccountKeys, listCustomerSales } from '../../api/customerAccounts';
import type { SaleSummary } from '../../api/sales';
import { Can } from '../../components/Can';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, TableWrap } from '../../components/ui/Card';
import { ListRow, ListSection } from '../../components/ui/List';
import { EmptyState, LoadingState, QueryView } from '../../components/ui/States';
import { SALE_SOURCE_LABELS } from '../../lib/categories';
import { fmtDate, fmtPct, fmtQty, fmtUsd, signClass, toNum } from '../../lib/format';

interface CustomerSalesTabProps {
  customerId: number;
  onSold: () => void;
}

/** All sales to the customer (from our stock and reported from their warehouse), newest first. */
export function CustomerSalesTab({ customerId, onSold }: CustomerSalesTabProps) {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: customerAccountKeys.sales(customerId),
    queryFn: () => listCustomerSales(customerId),
  });

  const note = "Har bir sotuv summasi nasiyaga yoziladi. Batafsil va o'chirish — sotuv sahifasida.";
  const empty = (
    <EmptyState
      title="Hali sotuv yo'q"
      description="Mijoz sotgan mol «Sotildi» orqali, ombordan to'g'ridan-to'g'ri sotuv esa «Sotuvlar» bo'limida kiritiladi."
      action={
        <Can do="customerMoves.write">
          <Button size="sm" variant="primary" onClick={onSold}>
            Sotildi
          </Button>
        </Can>
      }
    />
  );

  return (
    <>
      {/* iPhone: each sale opens its own page */}
      <div className="md:hidden">
        <QueryView query={query} isEmpty={(rows) => rows.length === 0} empty={empty} loading={<LoadingState />}>
          {(rows) => {
            const t = sumSales(rows);
            return (
              <div className="space-y-6">
                <ListSection header="Sotuvlar" footer={note}>
                  {rows.map((s) => (
                    <ListRow
                      key={s.id}
                      to={`/sales/${s.id}`}
                      title={fmtDate(s.sale_date)}
                      subtitle={`№${s.id} · ${SALE_SOURCE_LABELS[s.source]} · ${fmtQty(s.total_qty)} dona`}
                      value={fmtUsd(s.revenue, { symbol: true })}
                      valueStrong
                      valueSub={<span className={signClass(s.profit)}>foyda {fmtUsd(s.profit)}</span>}
                    />
                  ))}
                </ListSection>
                <ListSection header="Jami">
                  <ListRow
                    title="Tushum"
                    subtitle={`${fmtQty(rows.length)} ta sotuv · ${fmtQty(t.qty)} dona`}
                    value={fmtUsd(t.revenue, { symbol: true })}
                    valueStrong
                  />
                  <ListRow title="Tannarx" value={fmtUsd(t.cost, { symbol: true })} />
                  <ListRow
                    title="Foyda"
                    value={<span className={signClass(t.profit)}>{fmtUsd(t.profit, { symbol: true })}</span>}
                  />
                  <ListRow title="Marja" value={t.revenue !== 0 ? fmtPct(t.profit / t.revenue, 1) : '—'} />
                </ListSection>
              </div>
            );
          }}
        </QueryView>
      </div>

      <Card className="hidden md:block" title="Sotuvlar" subtitle={note}>
        <QueryView query={query} isEmpty={(rows) => rows.length === 0} empty={empty}>
          {(rows) => {
            const t = sumSales(rows);
            return (
              <TableWrap>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Sana</th>
                      <th>№</th>
                      <th>Manba</th>
                      <th className="num">Soni</th>
                      <th className="num">Tushum ($)</th>
                      <th className="num">Tannarx ($)</th>
                      <th className="num">Foyda ($)</th>
                      <th className="num">Marja</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => {
                      const revenue = toNum(s.revenue);
                      return (
                        <tr key={s.id} className="row-link" onClick={() => navigate(`/sales/${s.id}`)}>
                          <td className="whitespace-nowrap font-medium text-primary-700">
                            <Link to={`/sales/${s.id}`} onClick={(e) => e.stopPropagation()}>
                              {fmtDate(s.sale_date)}
                            </Link>
                          </td>
                          <td className="text-slate-500">{s.id}</td>
                          <td>
                            {s.source === 'consignment' ? (
                              <Badge tone="primary">{SALE_SOURCE_LABELS.consignment}</Badge>
                            ) : (
                              <span className="text-xs text-slate-500">{SALE_SOURCE_LABELS.stock}</span>
                            )}
                          </td>
                          <td className="num">{fmtQty(s.total_qty)}</td>
                          <td className="num">{fmtUsd(s.revenue)}</td>
                          <td className="num text-slate-500">{fmtUsd(s.cost)}</td>
                          <td className={`num font-medium ${signClass(s.profit)}`}>{fmtUsd(s.profit)}</td>
                          <td className="num text-slate-500">
                            {revenue !== 0 ? fmtPct(toNum(s.profit) / revenue, 1) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>Jami: {fmtQty(rows.length)} ta sotuv</td>
                      <td className="num">{fmtQty(t.qty)}</td>
                      <td className="num">{fmtUsd(t.revenue)}</td>
                      <td className="num">{fmtUsd(t.cost)}</td>
                      <td className={`num ${signClass(t.profit)}`}>{fmtUsd(t.profit)}</td>
                      <td className="num">{t.revenue !== 0 ? fmtPct(t.profit / t.revenue, 1) : '—'}</td>
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

function sumSales(rows: SaleSummary[]) {
  return rows.reduce(
    (acc, r) => ({
      qty: acc.qty + r.total_qty,
      revenue: acc.revenue + toNum(r.revenue),
      cost: acc.cost + toNum(r.cost),
      profit: acc.profit + toNum(r.profit),
    }),
    { qty: 0, revenue: 0, cost: 0, profit: 0 },
  );
}

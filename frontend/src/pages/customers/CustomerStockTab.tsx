import { Fragment, useState } from 'react';
import type { CustomerStockItem } from '../../api/customerAccounts';
import { Can } from '../../components/Can';
import { Button } from '../../components/ui/Button';
import { Card, TableWrap } from '../../components/ui/Card';
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from '../../components/ui/icons';
import { ListRow, ListSection } from '../../components/ui/List';
import { EmptyState, LoadingState, QueryView } from '../../components/ui/States';
import { fmtDate, fmtQty, fmtUsd, toNum } from '../../lib/format';
import { useCustomerStock } from '../../lib/queries';

interface CustomerStockTabProps {
  customerId: number;
  onGive: () => void;
}

/** What the customer currently holds, per product, with a per-batch breakdown. */
export function CustomerStockTab({ customerId, onGive }: CustomerStockTabProps) {
  const query = useCustomerStock(customerId);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const empty = (
    <EmptyState
      title="Mijozda mol yo'q"
      description="Mol berilgach, shu yerda mahsulot va partiya bo'yicha ko'rinadi."
      action={
        <Can do="customerMoves.write">
          <Button size="sm" variant="primary" icon={<PlusIcon className="h-3.5 w-3.5" />} onClick={onGive}>
            Mol berish
          </Button>
        </Can>
      }
    />
  );
  const isEmpty = (rows: CustomerStockItem[]) => rows.every((r) => r.qty <= 0);

  return (
    <>
      {/* iPhone: one row per product; tapping it unfolds the batches underneath (outline list) */}
      <div className="md:hidden">
        <QueryView query={query} isEmpty={isEmpty} empty={empty} loading={<LoadingState />}>
          {(data) => {
            const rows = data.filter((r) => r.qty > 0);
            const totalQty = rows.reduce((s, r) => s + r.qty, 0);
            const totalCost = rows.reduce((s, r) => s + toNum(r.value_cost), 0);
            const totalPrice = rows.reduce((s, r) => s + toNum(r.value_price), 0);
            return (
              <div className="space-y-6">
                <ListSection
                  header="Mijoz qo'lidagi mol"
                  footer="Mol bizniki: mijoz sotmaguncha nasiyaga yozilmaydi. Qiymat — tannarx va oxirgi kelishilgan narx bo'yicha."
                >
                  {rows.map((item) => {
                    const open = expanded.has(item.product.id);
                    return (
                      <Fragment key={item.product.id}>
                        <ListRow
                          leading={
                            <ChevronRightIcon
                              className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 [&>path]:stroke-[2.2] ${
                                open ? 'rotate-90' : ''
                              }`}
                            />
                          }
                          title={item.product.name}
                          subtitle={
                            item.price_usd === null
                              ? `Tannarx ${fmtUsd(item.avg_unit_cost)} $ · narx yo'q`
                              : `Narx ${fmtUsd(item.price_usd)} $ · tannarx ${fmtUsd(item.avg_unit_cost)} $`
                          }
                          value={`${fmtQty(item.qty)} dona`}
                          valueStrong
                          valueSub={fmtUsd(item.value_price, { symbol: true })}
                          onClick={() => toggle(item.product.id)}
                        />
                        {open &&
                          item.lines.map((l) => (
                            <ListRow
                              key={l.purchase_line_id}
                              leading={<span className="w-4 shrink-0" />}
                              title={<span className="text-[15px] text-slate-600">Partiya {fmtDate(l.batch_date)}</span>}
                              subtitle={`Tannarx ${fmtUsd(l.unit_cost)} $ · narx ${
                                l.price_usd === null ? '—' : `${fmtUsd(l.price_usd)} $`
                              }`}
                              value={`${fmtQty(l.qty)} dona`}
                            />
                          ))}
                      </Fragment>
                    );
                  })}
                </ListSection>
                <ListSection header="Jami">
                  <ListRow title="Soni" subtitle={`${fmtQty(rows.length)} ta mahsulot`} value={`${fmtQty(totalQty)} dona`} />
                  <ListRow
                    title="Tannarx qiymati"
                    subtitle={`O'rt. tannarx ${fmtUsd(totalQty > 0 ? totalCost / totalQty : 0)} $`}
                    value={fmtUsd(totalCost, { symbol: true })}
                  />
                  <ListRow title="Narxdagi qiymati" value={fmtUsd(totalPrice, { symbol: true })} valueStrong />
                </ListSection>
              </div>
            );
          }}
        </QueryView>
      </div>

      <Card
        className="hidden md:block"
        title="Mijoz qo'lidagi mol"
        subtitle="Mol bizniki: mijoz sotmaguncha nasiyaga yozilmaydi. Qiymat — tannarx va oxirgi kelishilgan narx bo'yicha."
      >
        <QueryView query={query} isEmpty={isEmpty} empty={empty}>
          {(data) => {
            const rows = data.filter((r) => r.qty > 0);
            const totalQty = rows.reduce((s, r) => s + r.qty, 0);
            const totalCost = rows.reduce((s, r) => s + toNum(r.value_cost), 0);
            const totalPrice = rows.reduce((s, r) => s + toNum(r.value_price), 0);
            return (
              <TableWrap>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="w-6" />
                      <th>Mahsulot</th>
                      <th className="num">Soni</th>
                      <th className="num">O'rt. tannarx ($)</th>
                      <th className="num">Tannarx qiymati ($)</th>
                      <th className="num">Kelishilgan narx ($)</th>
                      <th className="num">Narxdagi qiymati ($)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((item) => {
                      const open = expanded.has(item.product.id);
                      return (
                        <Fragment key={item.product.id}>
                          <tr className="row-link" onClick={() => toggle(item.product.id)}>
                            <td className="text-slate-400">
                              {open ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
                            </td>
                            <td className="font-medium text-slate-900">{item.product.name}</td>
                            <td className="num font-semibold">{fmtQty(item.qty)}</td>
                            <td className="num">{fmtUsd(item.avg_unit_cost)}</td>
                            <td className="num text-slate-500">{fmtUsd(item.value_cost)}</td>
                            <td className="num">
                              {item.price_usd === null ? <span className="text-slate-300">—</span> : fmtUsd(item.price_usd)}
                            </td>
                            <td className="num font-medium">{fmtUsd(item.value_price)}</td>
                          </tr>
                          {open && (
                            <tr className="tbl-sub">
                              <td />
                              <td colSpan={6} className="!py-2">
                                <table className="tbl rounded-xl bg-surface ring-1 ring-slate-200">
                                  <thead>
                                    <tr>
                                      <th>Partiya sanasi</th>
                                      <th className="num">Soni</th>
                                      <th className="num">Tannarx / dona ($)</th>
                                      <th className="num">Kelishilgan narx ($)</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {item.lines.map((l) => (
                                      <tr key={l.purchase_line_id}>
                                        <td>{fmtDate(l.batch_date)}</td>
                                        <td className="num">{fmtQty(l.qty)}</td>
                                        <td className="num">{fmtUsd(l.unit_cost)}</td>
                                        <td className="num">
                                          {l.price_usd === null ? <span className="text-slate-300">—</span> : fmtUsd(l.price_usd)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td />
                      <td>Jami: {fmtQty(rows.length)} ta mahsulot</td>
                      <td className="num">{fmtQty(totalQty)}</td>
                      <td className="num">{fmtUsd(totalQty > 0 ? totalCost / totalQty : 0)}</td>
                      <td className="num">{fmtUsd(totalCost)}</td>
                      <td />
                      <td className="num">{fmtUsd(totalPrice)}</td>
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

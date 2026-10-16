import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listStock, stockKeys, type StockItem, type StockLine } from '../../api/stock';
import { Can } from '../../components/Can';
import { Button } from '../../components/ui/Button';
import { Card, TableWrap } from '../../components/ui/Card';
import { BanknotesIcon, ChartIcon, ChevronDownIcon, ChevronRightIcon, CubeIcon, PhoneIcon } from '../../components/ui/icons';
import { PageHeader } from '../../components/ui/PageHeader';
import { SearchField } from '../../components/ui/SearchField';
import { EmptyState, LoadingState, QueryView } from '../../components/ui/States';
import { StatCard } from '../../components/ui/StatCard';
import { useCan } from '../../lib/auth';
import { fmtDate, fmtQty, fmtUsd, toNum } from '../../lib/format';
import { useDebounced } from '../../lib/useDebounced';
import { AdjustmentModal } from './AdjustmentModal';
import { OpeningBalanceModal } from './OpeningBalanceModal';
import { StockList } from './StockList';

const SEARCH_PLACEHOLDER = 'Qidirish: 17 pro max 256…';

export function StockPage() {
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);
  const query = useQuery({ queryKey: stockKeys.list(q), queryFn: () => listStock(q || undefined) });
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [openingOpen, setOpeningOpen] = useState(false);
  const [adjusting, setAdjusting] = useState<{ item: StockItem; line: StockLine } | null>(null);
  const can = useCan();
  const canWrite = can('stock.write');

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const empty = (
    <EmptyState
      title={q ? `«${q}» bo'yicha qoldiq topilmadi` : "Omborda mahsulot yo'q"}
      description={
        q ? "Boshqa so'z bilan qidiring." : "Xarid kiritilgach yoki Excel import qilingach, qoldiq shu yerda ko'rinadi."
      }
    />
  );

  return (
    <div>
      <PageHeader
        title="Ombor"
        subtitle="O'z mollari qoldig'i (mijoz uchun xaridlar kirmaydi). Tannarx — partiya bo'yicha amaldagi tannarx."
        actions={
          <Can do="stock.write">
            <Button onClick={() => setOpeningOpen(true)}>Boshlang'ich qoldiq</Button>
          </Can>
        }
      />

      {/* iPhone: search under the large title (it narrows the widgets below too). */}
      <SearchField value={search} onChange={setSearch} placeholder={SEARCH_PLACEHOLDER} className="-mt-2 mb-5 md:hidden" />

      {query.data && (
        <div className="mb-8 grid md:mb-4 grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard icon={PhoneIcon} tint="gray" label="Mahsulot turlari" value={fmtQty(query.data.filter((i) => i.qty > 0).length)} />
          <StatCard icon={CubeIcon} tint="brown" label="Jami qoldiq" value={`${fmtQty(query.data.reduce((s, i) => s + i.qty, 0))} dona`} />
          <StatCard
            icon={BanknotesIcon}
            tint="green"
            label="Ombor qiymati"
            value={fmtUsd(
              query.data.reduce((s, i) => s + toNum(i.stock_value), 0),
              { symbol: true },
            )}
          />
          <StatCard
            icon={ChartIcon}
            tint="blue"
            label="O'rtacha tannarx"
            value={(() => {
              const qty = query.data.reduce((s, i) => s + i.qty, 0);
              const value = query.data.reduce((s, i) => s + toNum(i.stock_value), 0);
              return fmtUsd(qty > 0 ? value / qty : 0, { symbol: true });
            })()}
          />
        </div>
      )}

      {/* iPhone: inset-grouped list with tap-to-expand batches. */}
      <div className="md:hidden">
        <QueryView query={query} isEmpty={(rows) => rows.length === 0} empty={empty} loading={<LoadingState />}>
          {(rows) => (
            <StockList
              rows={rows}
              expanded={expanded}
              onToggle={toggle}
              canWrite={canWrite}
              onAdjust={(item, line) => setAdjusting({ item, line })}
            />
          )}
        </QueryView>
      </div>

      {/* iPad / Mac: the table. */}
      <Card
        className="hidden md:block"
        title="Mahsulotlar bo'yicha qoldiq"
        actions={<SearchField value={search} onChange={setSearch} placeholder={SEARCH_PLACEHOLDER} className="w-64" />}
      >
        <QueryView query={query} isEmpty={(rows) => rows.length === 0} empty={empty}>
          {(rows) => {
            const totalQty = rows.reduce((s, i) => s + i.qty, 0);
            const totalValue = rows.reduce((s, i) => s + toNum(i.stock_value), 0);
            return (
              <TableWrap>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="w-6" />
                      <th>Mahsulot</th>
                      <th className="num">Qoldiq (dona)</th>
                      <th className="num">O'rt. tannarx ($)</th>
                      <th className="num">Qiymat ($)</th>
                      <th className="num">Partiyalar</th>
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
                            <td className="num">{fmtUsd(item.stock_value)}</td>
                            <td className="num text-slate-500">{fmtQty(item.lines.length)}</td>
                          </tr>
                          {open && (
                            <tr className="tbl-sub">
                              <td />
                              <td colSpan={5} className="!py-2">
                                <table className="tbl rounded-xl bg-surface ring-1 ring-slate-200">
                                  <thead>
                                    <tr>
                                      <th>Partiya sanasi</th>
                                      <th className="num">Qoldiq (dona)</th>
                                      <th className="num">Tannarx / dona ($)</th>
                                      <th className="num">Qiymat ($)</th>
                                      {canWrite && <th />}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {item.lines.map((l) => (
                                      <tr key={l.purchase_line_id}>
                                        <td>
                                          <Link
                                            to={`/batches/${l.batch_id}`}
                                            className="font-medium text-primary-700 hover:underline"
                                          >
                                            {fmtDate(l.batch_date)}
                                          </Link>
                                        </td>
                                        <td className="num">{fmtQty(l.remaining_qty)}</td>
                                        <td className="num">{fmtUsd(l.unit_cost)}</td>
                                        <td className="num">{fmtUsd(toNum(l.unit_cost) * l.remaining_qty)}</td>
                                        {canWrite && (
                                          <td className="w-40 text-right">
                                            <Button size="xs" variant="ghost" onClick={() => setAdjusting({ item, line: l })}>
                                              Hisobdan chiqarish
                                            </Button>
                                          </td>
                                        )}
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
                      <td className="num">{fmtUsd(totalQty > 0 ? totalValue / totalQty : 0)}</td>
                      <td className="num">{fmtUsd(totalValue)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </TableWrap>
            );
          }}
        </QueryView>
      </Card>

      {openingOpen && (
        <OpeningBalanceModal onClose={() => setOpeningOpen(false)} />
      )}
      {adjusting && (
        <AdjustmentModal item={adjusting.item} line={adjusting.line} onClose={() => setAdjusting(null)} />
      )}
    </div>
  );
}

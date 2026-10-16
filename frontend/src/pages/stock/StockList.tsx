import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import type { StockItem, StockLine } from '../../api/stock';
import { Button } from '../../components/ui/Button';
import { ChevronRightIcon } from '../../components/ui/icons';
import { ListRow, ListSection } from '../../components/ui/List';
import { fmtDate, fmtQty, fmtUsd, toNum } from '../../lib/format';

interface StockListProps {
  rows: StockItem[];
  expanded: Set<number>;
  onToggle: (productId: number) => void;
  canWrite: boolean;
  onAdjust: (item: StockItem, line: StockLine) => void;
}

/**
 * iPhone layout of the stock table: one inset-grouped section, a row per product with a disclosure
 * chevron; tapping it reveals the product's batches as indented rows (like an iOS DisclosureGroup).
 */
export function StockList({ rows, expanded, onToggle, canWrite, onAdjust }: StockListProps) {
  const totalQty = rows.reduce((s, i) => s + i.qty, 0);
  const totalValue = rows.reduce((s, i) => s + toNum(i.stock_value), 0);
  return (
    <ListSection
      header="Mahsulotlar bo'yicha qoldiq"
      footer={`Jami: ${fmtQty(rows.length)} ta mahsulot · ${fmtQty(totalQty)} dona · ${fmtUsd(totalValue, { symbol: true })}`}
    >
      {rows.map((item) => {
        const open = expanded.has(item.product.id);
        return (
          <Fragment key={item.product.id}>
            <ListRow
              onClick={() => onToggle(item.product.id)}
              leading={
                <ChevronRightIcon
                  className={`h-[15px] w-[15px] shrink-0 text-slate-400 transition-transform duration-200 [&>path]:stroke-[2.4] ${
                    open ? 'rotate-90' : ''
                  }`}
                />
              }
              title={item.product.name}
              subtitle={`O'rt. ${fmtUsd(item.avg_unit_cost, { symbol: true })} · ${fmtQty(item.lines.length)} partiya`}
              value={fmtQty(item.qty)}
              valueStrong
              valueSub="dona"
            />
            {open &&
              item.lines.map((line) => (
                <BatchRow
                  key={line.purchase_line_id}
                  line={line}
                  onAdjust={canWrite ? () => onAdjust(item, line) : undefined}
                />
              ))}
          </Fragment>
        );
      })}
    </ListSection>
  );
}

/** Indented child row: the batch opens its detail page; the write-off capsule sits under its facts. */
function BatchRow({ line, onAdjust }: { line: StockLine; onAdjust?: () => void }) {
  return (
    <li className="relative">
      <Link
        to={`/batches/${line.batch_id}`}
        className="flex min-h-[48px] items-center gap-3 py-[9px] pl-[58px] pr-4 transition-colors active:bg-slate-200/70"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] leading-5 tracking-[-0.015em] text-slate-900">
            Partiya {fmtDate(line.batch_date)}
          </div>
          <div className="mt-0.5 truncate text-[13px] leading-[18px] text-slate-500">
            {fmtUsd(line.unit_cost, { symbol: true })} / dona · {fmtUsd(toNum(line.unit_cost) * line.remaining_qty, { symbol: true })}
          </div>
        </div>
        <div className="shrink-0 text-right tabular-nums">
          <div className="text-[15px] leading-5 text-slate-900">{fmtQty(line.remaining_qty)}</div>
          <div className="mt-0.5 text-[12px] leading-4 text-slate-500">dona</div>
        </div>
        <ChevronRightIcon className="h-[15px] w-[15px] shrink-0 text-slate-300 [&>path]:stroke-[2.2]" />
      </Link>
      {onAdjust && (
        <div className="-mt-0.5 pb-3 pl-[58px]">
          <Button size="xs" onClick={onAdjust}>
            Hisobdan chiqarish
          </Button>
        </div>
      )}
      <span className="list-sep pointer-events-none absolute bottom-0 left-[58px] right-0 h-[0.5px] bg-slate-200" />
    </li>
  );
}

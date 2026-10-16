import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../api/client';
import {
  createConsignmentSale,
  createCustomerMove,
  type ConsignmentMove,
  type CustomerStockItem,
} from '../../api/customerAccounts';
import { saleKeys, type SaleDetail } from '../../api/sales';
import { listStock, stockKeys, type StockItem } from '../../api/stock';
import type { ISODate } from '../../api/types';
import { ProductSelect } from '../../components/ProductSelect';
import { Alert } from '../../components/ui/Alert';
import { Button, IconButton } from '../../components/ui/Button';
import type { ComboOption } from '../../components/ui/Combobox';
import { PlusIcon, TrashIcon } from '../../components/ui/icons';
import { Field, Input, NumberInput } from '../../components/ui/Input';
import { Modal, ModalBody, ModalFooter } from '../../components/ui/Modal';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { todayISO } from '../../lib/dates';
import { fmtQty, fmtUsd, numToInput, parseInputNumber, roundTo, signClass, toNum } from '../../lib/format';
import { invalidateLedger, useCustomerStock } from '../../lib/queries';

/** `out` = handover from our stock, `return` = back to our stock, `sold` = reported sale from the customer's stock. */
export type ConsignmentMode = 'out' | 'return' | 'sold';

interface ConsignmentModalProps {
  mode: ConsignmentMode;
  customerId: number;
  customerName: string;
  onClose: () => void;
  /** Called after a successful save (the modal is closed by the caller). */
  onSaved: (mode: ConsignmentMode) => void;
}

/** A product the user may pick, with the qty available at the source warehouse. */
interface SourceItem {
  product_id: number;
  name: string;
  qty: number;
  unitCost: number;
  /** Latest agreed price (customer stock only). */
  price: number | null;
}

interface SourceState {
  loading: boolean;
  error: Error | null;
  retry: () => void;
  items: SourceItem[];
}

interface LineDraft {
  key: number;
  product_id: number | null;
  qty: string;
  price_usd: string;
}

interface ModeConfig {
  title: string;
  subtitle: string;
  submit: string;
  priced: boolean;
  /** Prefix for the available qty hint: "Omborda 5 dona" / "Mijozda 5 dona". */
  where: string;
  emptyTitle: string;
  emptyDescription: string;
}

const MODES: Record<ConsignmentMode, ModeConfig> = {
  out: {
    title: 'Mol berish',
    subtitle: "Mol bizniki bo'lib qoladi; mijoz sotgach, sotuv sifatida nasiyaga yoziladi.",
    submit: 'Topshirish',
    priced: true,
    where: 'Omborda',
    emptyTitle: "Omborda berish uchun mol yo'q",
    emptyDescription: "Avval xarid kiriting yoki ombor qoldig'ini tekshiring.",
  },
  return: {
    title: 'Qaytarish',
    subtitle: 'Mijoz qaytargan mol omborimizga qaytadi (oxirgi topshiruvdan boshlab).',
    submit: 'Qaytarish',
    priced: false,
    where: 'Mijozda',
    emptyTitle: "Mijozda qaytariladigan mol yo'q",
    emptyDescription: "Avval «Mol berish» orqali mol topshiring.",
  },
  sold: {
    title: 'Sotildi',
    subtitle: "Mijoz sotgan mol sotuv sifatida yoziladi va nasiyaga qo'shiladi. Narx oxirgi kelishilgan narx bilan to'ldiriladi.",
    submit: 'Sotuvni saqlash',
    priced: true,
    where: 'Mijozda',
    emptyTitle: "Mijozda sotiladigan mol yo'q",
    emptyDescription: "Avval «Mol berish» orqali mol topshiring.",
  },
};

// Phones: product + delete on the first row, then qty / price / sum. One row from `sm` up (DOM order).
// Literal strings so Tailwind sees them.
const GRID_PRICED = 'grid grid-cols-12 items-start gap-2 sm:grid-cols-[minmax(0,1fr)_80px_110px_110px_32px]';
const HEAD_PRICED = 'hidden sm:grid sm:grid-cols-[minmax(0,1fr)_80px_110px_110px_32px] sm:gap-2';
const GRID_QTY = 'grid grid-cols-12 items-start gap-2 sm:grid-cols-[minmax(0,1fr)_110px_32px]';
const HEAD_QTY = 'hidden sm:grid sm:grid-cols-[minmax(0,1fr)_110px_32px] sm:gap-2';

let seq = 0;
function newLine(): LineDraft {
  seq += 1;
  return { key: seq, product_id: null, qty: '', price_usd: '' };
}

export function ConsignmentModal(props: ConsignmentModalProps) {
  return props.mode === 'out' ? <FromOurStock {...props} /> : <FromCustomerStock {...props} />;
}

function FromOurStock(props: ConsignmentModalProps) {
  // Unfiltered list, shared with the sale form and the stock page.
  const stock = useQuery({ queryKey: stockKeys.list(''), queryFn: () => listStock() });
  const items = useMemo(
    () =>
      (stock.data ?? [])
        .filter((s: StockItem) => s.qty > 0)
        .map<SourceItem>((s) => ({
          product_id: s.product.id,
          name: s.product.name,
          qty: s.qty,
          unitCost: toNum(s.avg_unit_cost),
          price: null,
        })),
    [stock.data],
  );
  return (
    <ConsignmentShell
      {...props}
      source={{ loading: stock.isPending, error: stock.error, retry: () => void stock.refetch(), items }}
    />
  );
}

function FromCustomerStock(props: ConsignmentModalProps) {
  const stock = useCustomerStock(props.customerId);
  const items = useMemo(
    () =>
      (stock.data ?? [])
        .filter((s: CustomerStockItem) => s.qty > 0)
        .map<SourceItem>((s) => ({
          product_id: s.product.id,
          name: s.product.name,
          qty: s.qty,
          unitCost: toNum(s.avg_unit_cost),
          price: s.price_usd === null ? null : toNum(s.price_usd),
        })),
    [stock.data],
  );
  return (
    <ConsignmentShell
      {...props}
      source={{ loading: stock.isPending, error: stock.error, retry: () => void stock.refetch(), items }}
    />
  );
}

function ConsignmentShell({ source, ...props }: ConsignmentModalProps & { source: SourceState }) {
  const cfg = MODES[props.mode];
  const fallback = (body: ReactNode) => (
    <>
      <ModalBody>{body}</ModalBody>
      <ModalFooter>
        <Button onClick={props.onClose}>Yopish</Button>
      </ModalFooter>
    </>
  );

  let content: ReactNode;
  if (source.loading) content = fallback(<LoadingState rows={4} className="!p-0" />);
  else if (source.error) content = fallback(<ErrorState error={source.error} onRetry={source.retry} />);
  else if (source.items.length === 0)
    content = fallback(<EmptyState title={cfg.emptyTitle} description={cfg.emptyDescription} />);
  else content = <ConsignmentForm {...props} items={source.items} />;

  return (
    <Modal
      open
      title={`${cfg.title} · ${props.customerName}`}
      subtitle={cfg.subtitle}
      onClose={props.onClose}
      size={cfg.priced ? 'xl' : 'lg'}
    >
      {content}
    </Modal>
  );
}

type SaveResult = { kind: 'move'; move: ConsignmentMove } | { kind: 'sale'; sale: SaleDetail };

function ConsignmentForm({
  mode,
  customerId,
  items,
  onClose,
  onSaved,
}: ConsignmentModalProps & { items: SourceItem[] }) {
  const cfg = MODES[mode];
  const queryClient = useQueryClient();
  const toast = useToast();
  const [date, setDate] = useState<ISODate>(todayISO());
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [submitted, setSubmitted] = useState(false);

  const itemById = useMemo(() => new Map(items.map((i) => [i.product_id, i])), [items]);
  const options = useMemo<ComboOption[]>(
    () =>
      items.map((i) => ({
        id: i.product_id,
        label: i.name,
        hint:
          mode === 'out'
            ? `${fmtQty(i.qty)} dona · ${fmtUsd(i.unitCost)} $`
            : i.price !== null && cfg.priced
              ? `${fmtQty(i.qty)} dona · ${fmtUsd(i.price)} $`
              : `${fmtQty(i.qty)} dona`,
      })),
    [items, mode, cfg.priced],
  );

  const patchLine = (key: number, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const onProductChange = (line: LineDraft, productId: number | null) => {
    if (mode !== 'sold') {
      patchLine(line.key, { product_id: productId });
      return;
    }
    // Pre-fill the latest agreed price; it stays editable.
    const item = productId !== null ? itemById.get(productId) : undefined;
    patchLine(line.key, {
      product_id: productId,
      price_usd: item && item.price !== null ? numToInput(item.price) : '',
    });
  };

  const computed = useMemo(() => {
    // The same product may appear on several lines; check the sum against what is available.
    const demand = new Map<number, number>();
    for (const l of lines) {
      if (l.product_id === null) continue;
      demand.set(l.product_id, (demand.get(l.product_id) ?? 0) + (parseInputNumber(l.qty) ?? 0));
    }
    return lines.map((l) => {
      const item = l.product_id !== null ? itemById.get(l.product_id) : undefined;
      const qty = parseInputNumber(l.qty);
      const price = parseInputNumber(l.price_usd);
      const q = qty ?? 0;
      const total = cfg.priced ? q * (price ?? 0) : 0;
      const cost = q * (item?.unitCost ?? 0);

      let error: string | null = null;
      if (l.product_id === null) error = 'Mahsulotni tanlang';
      else if (qty === undefined || !Number.isInteger(qty) || qty <= 0) error = 'Soni: butun son > 0';
      else if (cfg.priced && (price === undefined || price <= 0)) error = "Narx 0 dan katta bo'lsin";
      else if (item && (demand.get(l.product_id) ?? 0) > item.qty)
        error = `${cfg.where} faqat ${fmtQty(item.qty)} dona bor`;
      else if (!item) error = `${cfg.where} bu mahsulot yo'q`;

      return { item, total, cost, error };
    });
  }, [lines, itemById, cfg.priced, cfg.where]);

  const totals = computed.reduce(
    (acc, c, i) => ({
      qty: acc.qty + (parseInputNumber(lines[i].qty) ?? 0),
      total: acc.total + c.total,
      cost: acc.cost + c.cost,
    }),
    { qty: 0, total: 0, cost: 0 },
  );
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const invalid = computed.some((c) => c.error !== null) || !dateValid;

  const mutation = useMutation({
    mutationFn: async (): Promise<SaveResult> => {
      const noteValue = note.trim() || null;
      if (mode === 'sold') {
        const sale = await createConsignmentSale(customerId, {
          sale_date: date,
          note: noteValue,
          lines: lines.map((l) => ({
            product_id: l.product_id ?? 0,
            qty: parseInputNumber(l.qty) ?? 0,
            price_usd: parseInputNumber(l.price_usd) ?? 0,
          })),
        });
        return { kind: 'sale', sale };
      }
      const move = await createCustomerMove(customerId, {
        move_date: date,
        kind: mode,
        note: noteValue,
        lines: lines.map((l) =>
          mode === 'out'
            ? {
                product_id: l.product_id ?? 0,
                qty: parseInputNumber(l.qty) ?? 0,
                // consignment_entries.price_usd is NUMERIC(12,2).
                price_usd: roundTo(parseInputNumber(l.price_usd) ?? 0, 2),
              }
            : { product_id: l.product_id ?? 0, qty: parseInputNumber(l.qty) ?? 0 },
        ),
      });
      return { kind: 'move', move };
    },
    onSuccess: (result) => {
      if (result.kind === 'sale') queryClient.setQueryData(saleKeys.detail(result.sale.id), result.sale);
      void invalidateLedger(queryClient);
      const qtyText = `${fmtQty(totals.qty)} dona`;
      if (mode === 'out') toast.success(`Mol berildi: ${qtyText}, ${fmtUsd(totals.total, { symbol: true })}`);
      else if (mode === 'return') toast.success(`Mol qaytarildi: ${qtyText}`);
      else toast.success(`Sotuv saqlandi: ${qtyText}, ${fmtUsd(totals.total, { symbol: true })} nasiyaga yozildi`);
      onSaved(mode);
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (invalid) return;
    mutation.mutate();
  };

  const grid = cfg.priced ? GRID_PRICED : GRID_QTY;
  const head = cfg.priced ? HEAD_PRICED : HEAD_QTY;

  return (
    <form onSubmit={onSubmit} noValidate>
      <ModalBody className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
          <Field label="Sana" htmlFor="cons-date" required>
            <Input
              id="cons-date"
              type="date"
              value={date}
              invalid={submitted && !dateValid}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Izoh" htmlFor="cons-note">
            <Input id="cons-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>

        <div className="space-y-2">
          <div className={`${head} border-b border-slate-200 pb-1.5 text-[12px] font-medium text-slate-500`}>
            <div>Mahsulot</div>
            <div className="text-right">Soni</div>
            {cfg.priced && <div className="text-right">Narx ($/dona)</div>}
            {cfg.priced && <div className="text-right">Summa ($)</div>}
            <div />
          </div>
          <div className="divide-y divide-slate-100">
            {lines.map((l, idx) => {
              const c = computed[idx];
              const showError = submitted && c.error !== null;
              return (
                <div key={l.key} className="py-2">
                  <div className={grid}>
                    <div className="order-1 col-span-10 sm:order-none sm:col-span-1">
                      <ProductSelect
                        options={options}
                        value={l.product_id}
                        onChange={(id) => onProductChange(l, id)}
                        invalid={showError && l.product_id === null}
                      />
                    </div>
                    <div className={`order-3 sm:order-none sm:col-span-1 ${cfg.priced ? 'col-span-4' : 'col-span-12'}`}>
                      <NumberInput
                        aria-label="Soni"
                        placeholder="Soni"
                        inputMode="numeric"
                        value={l.qty}
                        invalid={showError && l.product_id !== null}
                        onChange={(e) => patchLine(l.key, { qty: e.target.value })}
                      />
                    </div>
                    {cfg.priced && (
                      <div className="order-4 col-span-4 sm:order-none sm:col-span-1">
                        <NumberInput
                          aria-label="Narx ($/dona)"
                          placeholder="Narx"
                          value={l.price_usd}
                          invalid={showError && l.product_id !== null}
                          onChange={(e) => patchLine(l.key, { price_usd: e.target.value })}
                        />
                      </div>
                    )}
                    {cfg.priced && (
                      <div className="order-5 col-span-4 pt-2 text-right tabular-nums sm:order-none sm:col-span-1 sm:pt-1.5">
                        {fmtUsd(c.total)}
                      </div>
                    )}
                    <div className="order-2 col-span-2 flex justify-end sm:order-none sm:col-span-1">
                      <IconButton
                        label="O'chirish"
                        tone="danger"
                        className="sm:mt-1"
                        disabled={lines.length === 1}
                        onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </IconButton>
                    </div>
                  </div>
                  {showError ? (
                    <div className="mt-0.5 text-xs text-danger-600">{c.error}</div>
                  ) : (
                    c.item && (
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {cfg.where} {fmtQty(c.item.qty)} dona
                        {mode !== 'return' && <> · tannarx {fmtUsd(c.item.unitCost)} $</>}
                        {mode === 'sold' &&
                          (c.item.price !== null ? (
                            <> · kelishilgan narx {fmtUsd(c.item.price)} $</>
                          ) : (
                            <> · kelishilgan narx yo'q</>
                          ))}
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={<PlusIcon className="h-3.5 w-3.5" />}
            onClick={() => setLines((prev) => [...prev, newLine()])}
          >
            Qator qo'shish
          </Button>
        </div>

        <div className="flex flex-wrap items-baseline justify-end gap-x-4 gap-y-1 rounded-xl bg-slate-50 px-3 py-2 text-[13px]">
          <span>
            Jami: <span className="font-semibold tabular-nums">{fmtQty(totals.qty)} dona</span>
          </span>
          {cfg.priced && (
            <span>
              {mode === 'sold' ? 'Tushum' : 'Summa'}:{' '}
              <span className="font-semibold tabular-nums">{fmtUsd(totals.total, { symbol: true })}</span>
            </span>
          )}
          {mode === 'out' && (
            <span className="text-slate-500">
              tannarx: <span className="tabular-nums">{fmtUsd(totals.cost, { symbol: true })}</span>
            </span>
          )}
          {mode === 'sold' && (
            <span className="text-slate-500">
              taxm. foyda:{' '}
              <span className={`font-medium tabular-nums ${signClass(totals.total - totals.cost)}`}>
                {fmtUsd(totals.total - totals.cost, { symbol: true })}
              </span>
            </span>
          )}
        </div>

        {mutation.isError && (
          <Alert tone="danger" title="Saqlanmadi">
            {errorMessage(mutation.error)}
          </Alert>
        )}
        {submitted && invalid && !mutation.isError && <Alert tone="danger">Belgilangan qatorlarni to'g'rilang.</Alert>}
      </ModalBody>
      <ModalFooter>
        <Button onClick={onClose} disabled={mutation.isPending}>
          Bekor qilish
        </Button>
        <Button type="submit" variant="primary" loading={mutation.isPending}>
          {cfg.submit}
        </Button>
      </ModalFooter>
    </form>
  );
}

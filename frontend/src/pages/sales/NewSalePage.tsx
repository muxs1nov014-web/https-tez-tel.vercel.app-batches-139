import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { createSale, saleKeys, type SaleIn } from '../../api/sales';
import { listStock, stockKeys, type StockItem } from '../../api/stock';
import type { ISODate } from '../../api/types';
import { Alert } from '../../components/ui/Alert';
import { Button, ButtonLink, IconButton } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Combobox, type ComboOption } from '../../components/ui/Combobox';
import { PlusIcon, TrashIcon } from '../../components/ui/icons';
import { GridCell } from '../../components/ui/GridCell';
import { Field, Input, NumberInput, Select } from '../../components/ui/Input';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { StatCard } from '../../components/ui/StatCard';
import { useToast } from '../../components/ui/Toast';
import { CUSTOMER_KIND_LABELS } from '../../lib/categories';
import { todayISO } from '../../lib/dates';
import { fmtDate, fmtPct, fmtQty, fmtUsd, parseInputNumber, signClass, toNum } from '../../lib/format';
import { invalidateLedger, useCustomerList } from '../../lib/queries';

interface SaleLineDraft {
  key: number;
  product_id: number | null;
  batch_id: number | null;
  qty: string;
  price_usd: string;
}

interface BatchOption {
  batch_id: number;
  batch_date: ISODate;
  remaining: number;
  unit_cost: number;
}

let seq = 0;
function newLine(): SaleLineDraft {
  seq += 1;
  return { key: seq, product_id: null, batch_id: null, qty: '', price_usd: '' };
}

/** Stock lines grouped by batch (a batch may hold the same product on several purchase lines). */
function batchOptions(item: StockItem | undefined): BatchOption[] {
  if (!item) return [];
  const map = new Map<number, BatchOption & { value: number }>();
  for (const l of item.lines) {
    if (l.remaining_qty <= 0) continue;
    const cur = map.get(l.batch_id) ?? { batch_id: l.batch_id, batch_date: l.batch_date, remaining: 0, unit_cost: 0, value: 0 };
    cur.remaining += l.remaining_qty;
    cur.value += toNum(l.unit_cost) * l.remaining_qty;
    map.set(l.batch_id, cur);
  }
  return [...map.values()]
    .map(({ value, ...rest }) => ({ ...rest, unit_cost: rest.remaining > 0 ? value / rest.remaining : 0 }))
    .sort((a, b) => (a.batch_date < b.batch_date ? -1 : 1));
}

export function NewSalePage() {
  const stock = useQuery({ queryKey: stockKeys.list(''), queryFn: () => listStock() });
  const header = <PageHeader title="Yangi sotuv" back={{ to: '/sales', label: 'Sotuvlar' }} />;

  if (stock.isPending) {
    return (
      <div>
        {header}
        <LoadingState />
      </div>
    );
  }
  if (stock.isError) {
    return (
      <div>
        {header}
        <Card>
          <ErrorState error={stock.error} onRetry={() => void stock.refetch()} />
        </Card>
      </div>
    );
  }
  const available = stock.data.filter((s) => s.qty > 0);
  if (available.length === 0) {
    return (
      <div>
        {header}
        <Card>
          <EmptyState
            title="Omborda sotiladigan mahsulot yo'q"
            description="Avval xarid kiriting yoki boshlang'ich qoldiqni tekshiring."
            action={<ButtonLink to="/stock" size="sm">Omborga o'tish</ButtonLink>}
          />
        </Card>
      </div>
    );
  }
  return <NewSaleForm stock={available} />;
}

function NewSaleForm({ stock }: { stock: StockItem[] }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const customers = useCustomerList();

  const [date, setDate] = useState<ISODate>(todayISO());
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<SaleLineDraft[]>([newLine()]);
  const [submitted, setSubmitted] = useState(false);

  const stockById = useMemo(() => new Map(stock.map((s) => [s.product.id, s])), [stock]);
  const productOptions = useMemo<ComboOption[]>(
    () =>
      stock.map((s) => ({
        id: s.product.id,
        label: s.product.name,
        hint: `${fmtQty(s.qty)} dona · ${fmtUsd(s.avg_unit_cost)} $`,
      })),
    [stock],
  );
  const customerOptions = useMemo<ComboOption[]>(
    () =>
      (customers.data ?? [])
        .filter((c) => c.is_active)
        .map((c) => ({ id: c.id, label: c.name, hint: CUSTOMER_KIND_LABELS[c.kind], searchText: c.phone ?? '' })),
    [customers.data],
  );

  const patchLine = (key: number, patch: Partial<SaleLineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // Requested qty per (product, batch|FIFO) across all lines, to check availability.
  const computed = useMemo(() => {
    const demandByProduct = new Map<number, number>();
    const demandByBatch = new Map<string, number>();
    for (const l of lines) {
      if (l.product_id === null) continue;
      const q = parseInputNumber(l.qty) ?? 0;
      demandByProduct.set(l.product_id, (demandByProduct.get(l.product_id) ?? 0) + q);
      if (l.batch_id !== null) {
        const k = `${l.product_id}:${l.batch_id}`;
        demandByBatch.set(k, (demandByBatch.get(k) ?? 0) + q);
      }
    }

    return lines.map((l) => {
      const item = l.product_id !== null ? stockById.get(l.product_id) : undefined;
      const batches = batchOptions(item);
      const batch = l.batch_id !== null ? batches.find((b) => b.batch_id === l.batch_id) : undefined;
      const qty = parseInputNumber(l.qty);
      const price = parseInputNumber(l.price_usd);
      const unitCost = batch ? batch.unit_cost : toNum(item?.avg_unit_cost);
      const q = qty ?? 0;
      const revenue = q * (price ?? 0);
      const cost = q * unitCost;

      let error: string | null = null;
      if (l.product_id === null) error = 'Mahsulotni tanlang';
      else if (qty === undefined || !Number.isInteger(qty) || qty <= 0) error = 'Soni: butun son > 0';
      else if (price === undefined || price <= 0) error = "Narx 0 dan katta bo'lsin";
      else if (batch && (demandByBatch.get(`${l.product_id}:${batch.batch_id}`) ?? 0) > batch.remaining)
        error = `Bu partiyada faqat ${fmtQty(batch.remaining)} dona bor`;
      else if (item && (demandByProduct.get(l.product_id) ?? 0) > item.qty)
        error = `Omborda faqat ${fmtQty(item.qty)} dona bor`;

      return { item, batches, unitCost, revenue, cost, profit: revenue - cost, error };
    });
  }, [lines, stockById]);

  const totals = computed.reduce(
    (acc, c, i) => ({
      qty: acc.qty + (parseInputNumber(lines[i].qty) ?? 0),
      revenue: acc.revenue + c.revenue,
      cost: acc.cost + c.cost,
      profit: acc.profit + c.profit,
    }),
    { qty: 0, revenue: 0, cost: 0, profit: 0 },
  );
  const invalid = computed.some((c) => c.error !== null) || !/^\d{4}-\d{2}-\d{2}$/.test(date);

  const mutation = useMutation({
    mutationFn: (body: SaleIn) => createSale(body),
    onSuccess: (sale) => {
      queryClient.setQueryData(saleKeys.detail(sale.id), sale);
      void invalidateLedger(queryClient);
      toast.success(`Sotuv saqlandi: ${fmtQty(sale.totals.qty)} dona, foyda ${fmtUsd(sale.totals.profit, { symbol: true })}`);
      navigate(`/sales/${sale.id}`);
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (invalid) return;
    mutation.mutate({
      sale_date: date,
      customer_id: customerId,
      note: note.trim() || null,
      lines: lines.map((l) => ({
        product_id: l.product_id ?? 0,
        qty: parseInputNumber(l.qty) ?? 0,
        price_usd: parseInputNumber(l.price_usd) ?? 0,
        batch_id: l.batch_id,
      })),
    });
  };

  // lg+: one row per line; below lg the cells stack with their own captions (see GridCell).
  const GRID =
    'grid grid-cols-2 items-start gap-x-3 gap-y-3 sm:grid-cols-4 lg:grid-cols-[minmax(220px,1fr)_190px_80px_110px_110px_110px_110px_32px] lg:gap-2';

  return (
    <form onSubmit={onSubmit} noValidate>
      <PageHeader
        title="Yangi sotuv"
        subtitle="Tannarx taxminan o'rtacha tannarx bo'yicha ko'rsatiladi; saqlangach FIFO bo'yicha aniq hisoblanadi."
        back={{ to: '/sales', label: 'Sotuvlar' }}
      />
      <div className="space-y-4">
        <Card title="Sotuv" padded>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[160px_minmax(0,320px)_minmax(0,1fr)]">
            <Field label="Sana" htmlFor="sale-date" required>
              <Input
                id="sale-date"
                type="date"
                value={date}
                invalid={submitted && !date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="Mijoz / diler" htmlFor="sale-customer">
              <Combobox
                id="sale-customer"
                options={customerOptions}
                value={customerId}
                onChange={setCustomerId}
                loading={customers.isPending}
                clearable
                placeholder="Tanlanmagan"
              />
            </Field>
            <Field label="Izoh" htmlFor="sale-note">
              <Input id="sale-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card
          title="Mahsulotlar"
          actions={
            <Button
              size="sm"
              variant="subtle"
              icon={<PlusIcon className="h-3.5 w-3.5" />}
              onClick={() => setLines((prev) => [...prev, newLine()])}
            >
              Qator qo'shish
            </Button>
          }
        >
          <div className="px-3 py-2">
            <div className={`${GRID} hidden border-b border-slate-200 pb-1.5 text-[12px] font-medium text-slate-500 lg:grid`}>
              <div>Mahsulot</div>
              <div>Partiya</div>
              <div className="text-right">Soni</div>
              <div className="text-right">Narx ($/dona)</div>
              <div className="text-right">Tushum</div>
              <div className="text-right">Taxm. tannarx</div>
              <div className="text-right">Taxm. foyda</div>
              <div />
            </div>
            <div className="divide-y divide-slate-100">
              {lines.map((l, idx) => {
                const c = computed[idx];
                const showError = submitted && c.error;
                return (
                  <div key={l.key} className="py-3 lg:py-2">
                    <div className={GRID}>
                      <GridCell label="Mahsulot" className="col-span-2 lg:col-span-1">
                        <Combobox
                          options={productOptions}
                          value={l.product_id}
                          onChange={(id) => patchLine(l.key, { product_id: id, batch_id: null })}
                          invalid={Boolean(showError) && l.product_id === null}
                          placeholder="Mahsulotni qidiring…"
                        />
                      </GridCell>
                      <GridCell label="Partiya" className="col-span-2 lg:col-span-1">
                        <Select
                          aria-label="Partiya"
                          value={l.batch_id ?? ''}
                          disabled={l.product_id === null}
                          onChange={(e) => patchLine(l.key, { batch_id: e.target.value ? Number(e.target.value) : null })}
                        >
                          <option value="">FIFO (avtomatik)</option>
                          {c.batches.map((b) => (
                            <option key={b.batch_id} value={b.batch_id}>
                              {fmtDate(b.batch_date)} · {fmtQty(b.remaining)} dona · {fmtUsd(b.unit_cost)} $
                            </option>
                          ))}
                        </Select>
                      </GridCell>
                      <GridCell label="Soni">
                        <NumberInput
                          aria-label="Soni"
                          inputMode="numeric"
                          value={l.qty}
                          invalid={Boolean(showError) && l.product_id !== null}
                          onChange={(e) => patchLine(l.key, { qty: e.target.value })}
                        />
                      </GridCell>
                      <GridCell label="Narx ($/dona)">
                        <NumberInput
                          aria-label="Narx ($/dona)"
                          value={l.price_usd}
                          invalid={Boolean(showError) && l.product_id !== null}
                          onChange={(e) => patchLine(l.key, { price_usd: e.target.value })}
                        />
                      </GridCell>
                      <GridCell label="Tushum">
                        <div className="tabular-nums lg:pt-1.5 lg:text-right">{fmtUsd(c.revenue)}</div>
                      </GridCell>
                      <GridCell label="Taxm. tannarx">
                        <div className="tabular-nums text-slate-500 lg:pt-1.5 lg:text-right">
                          {fmtUsd(c.cost)}
                          {c.item && <div className="text-[11px]">{fmtUsd(c.unitCost)} / dona</div>}
                        </div>
                      </GridCell>
                      <GridCell label="Taxm. foyda">
                        <div className={`font-medium tabular-nums lg:pt-1.5 lg:text-right ${signClass(c.profit)}`}>
                          {fmtUsd(c.profit)}
                          {c.revenue > 0 && (
                            <div className="text-[11px] font-normal">{fmtPct(c.profit / c.revenue, 1)}</div>
                          )}
                        </div>
                      </GridCell>
                      <div className="flex items-end justify-end sm:col-span-1 lg:items-start">
                        <IconButton
                          label="O'chirish"
                          tone="danger"
                          className="lg:mt-1"
                          disabled={lines.length === 1}
                          onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </IconButton>
                      </div>
                    </div>
                    {c.item && !showError && (
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        Omborda {fmtQty(c.item.qty)} dona · o'rtacha tannarx {fmtUsd(c.item.avg_unit_cost)} $
                      </div>
                    )}
                    {showError && <div className="mt-0.5 text-xs text-danger-600">{c.error}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Jami dona" value={fmtQty(totals.qty)} />
          <StatCard label="Tushum" value={fmtUsd(totals.revenue, { symbol: true })} />
          <StatCard label="Taxminiy tannarx" value={fmtUsd(totals.cost, { symbol: true })} />
          <StatCard
            label="Taxminiy foyda"
            value={fmtUsd(totals.profit, { symbol: true })}
            valueClassName={signClass(totals.profit)}
            sub={totals.revenue > 0 ? `marja ${fmtPct(totals.profit / totals.revenue, 1)}` : undefined}
          />
        </div>

        {mutation.isError && <Alert tone="danger" title="Sotuv saqlanmadi">{errorMessage(mutation.error)}</Alert>}
        {submitted && invalid && !mutation.isError && (
          <Alert tone="danger">Belgilangan qatorlarni to'g'rilang.</Alert>
        )}

        {/* iPhone: full-width capsules, the primary one on top; sm+: right-aligned pair. */}
        <div className="flex flex-col-reverse gap-2.5 pt-1 sm:flex-row sm:justify-end sm:pt-0">
          <ButtonLink to="/sales" className="max-sm:h-12 max-sm:w-full max-sm:text-[17px]">
            Bekor qilish
          </ButtonLink>
          <Button
            type="submit"
            variant="primary"
            loading={mutation.isPending}
            className="max-sm:h-12 max-sm:w-full max-sm:text-[17px]"
          >
            Sotuvni saqlash
          </Button>
        </div>
      </div>
    </form>
  );
}

import { memo, useCallback, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { batchKeys, createBatch, listBatches, type BatchIn, type ExpenseIn } from '../../api/batches';
import type { Channel } from '../../api/channels';
import { errorMessage } from '../../api/client';
import type { Customer } from '../../api/customers';
import type { Category } from '../../api/meta';
import { batchExpenseDefaultKey, type Settings } from '../../api/settings';
import type { CategoryCode, ISODate } from '../../api/types';
import { ProductSelect } from '../../components/ProductSelect';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button, ButtonLink, IconButton } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ListRow, ListSection } from '../../components/ui/List';
import { ChevronDownIcon, ChevronRightIcon, CopyIcon, PlusIcon, TrashIcon } from '../../components/ui/icons';
import { GridCell } from '../../components/ui/GridCell';
import { Field, Input, NumberInput, Select } from '../../components/ui/Input';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { StatCard } from '../../components/ui/StatCard';
import { useToast } from '../../components/ui/Toast';
import { CATEGORY_FALLBACK } from '../../lib/categories';
import { previewBatch, type PreviewLineResult } from '../../lib/costing';
import { todayISO } from '../../lib/dates';
import { fmtDate, fmtQty, fmtUsd, fmtUsdUp, numToInput, parseInputNumber } from '../../lib/format';
import {
  useActiveProducts,
  useCategories,
  useChannels,
  useCustomerList,
  useSettings,
  invalidateLedger,
} from '../../lib/queries';
import { ClientFields, ExtraCostFields, RastamojkaInput } from './LineFields';
import {
  draftToLineIn,
  draftToPreview,
  duplicateDraft,
  emptyDraft,
  hasErrors,
  validateDraft,
  type DraftErrors,
  type LineDraft,
  type LineDraftPatch,
} from './lineDraft';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NO_ERRORS: DraftErrors = {};

type ExpenseInputs = Partial<Record<CategoryCode, string>>;

/** Batch expense inputs pre-filled from the defaults on the settings card. */
function defaultExpenses(settings: Settings, batchCategories: Category[]): ExpenseInputs {
  const values: ExpenseInputs = {};
  for (const c of batchCategories) {
    const key = batchExpenseDefaultKey(c.code);
    if (key) values[c.code] = numToInput(settings[key]);
  }
  return values;
}

/**
 * lg+: one row per line (product | channel | qty | price AED | rate | rastamojka | overhead | unit cost | actions).
 * Below lg the cells stack two or three per row with their own captions (see GridCell).
 */
const LINE_GRID =
  'grid grid-cols-2 items-start gap-x-3 gap-y-3 sm:grid-cols-3 lg:grid-cols-[minmax(200px,1fr)_120px_72px_104px_76px_116px_96px_104px_72px] lg:gap-2';

export function NewBatchPage() {
  const settings = useSettings();
  const channels = useChannels();
  const categories = useCategories();

  const header = <PageHeader title="Yangi xarid" back={{ to: '/batches', label: 'Partiyalar' }} />;

  if (settings.isPending || channels.isPending || categories.isPending) {
    return (
      <div>
        {header}
        <LoadingState />
      </div>
    );
  }
  if (settings.isError || channels.isError) {
    return (
      <div>
        {header}
        <ErrorState
          error={settings.error ?? channels.error}
          onRetry={() => {
            void settings.refetch();
            void channels.refetch();
          }}
        />
      </div>
    );
  }
  return (
    <NewBatchForm
      settings={settings.data}
      channels={channels.data}
      categories={categories.data ?? CATEGORY_FALLBACK}
    />
  );
}

interface NewBatchFormProps {
  settings: Settings;
  channels: Channel[];
  categories: Category[];
}

function NewBatchForm({ settings, channels, categories }: NewBatchFormProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const defaultChannelId = channels.find((c) => c.code === 'cargo')?.id ?? channels[0]?.id ?? null;
  const batchCategories = useMemo(() => categories.filter((c) => c.level === 'batch'), [categories]);

  const [date, setDate] = useState<ISODate>(todayISO());
  const [lines, setLines] = useState<LineDraft[]>(() => [emptyDraft(settings, defaultChannelId)]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expenses, setExpenses] = useState<ExpenseInputs>(() => defaultExpenses(settings, batchCategories));
  const [submitted, setSubmitted] = useState(false);

  const clients = useCustomerList({ kind: 'client' });
  const activeClients = useMemo(() => (clients.data ?? []).filter((c) => c.is_active), [clients.data]);

  const dateValid = ISO_DATE.test(date);
  const sameDate = useQuery({
    queryKey: batchKeys.list({ date_from: date, date_to: date }),
    queryFn: () => listBatches({ date_from: date, date_to: date }),
    enabled: dateValid,
  });
  const existingBatch = sameDate.data?.[0];

  const patchLine = useCallback((key: string, patch: LineDraftPatch) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }, []);

  const removeLine = useCallback((key: string) => {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }, []);

  const duplicateLine = useCallback((key: string) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.key === key);
      if (idx < 0) return prev;
      const copy = duplicateDraft(prev[idx]);
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
  }, []);

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const addLine = () => {
    const last = lines[lines.length - 1];
    const fresh = emptyDraft(settings, last?.channel_id ?? defaultChannelId);
    // Carry the rate over: all lines of one purchase day usually share it.
    if (last && last.rate) fresh.rate = last.rate;
    setLines((prev) => [...prev, fresh]);
  };

  const expenseErrors = useMemo(() => {
    const errors: Partial<Record<CategoryCode, string>> = {};
    for (const c of batchCategories) {
      const text = expenses[c.code] ?? '';
      if (text.trim() === '') continue;
      const n = parseInputNumber(text);
      if (n === undefined) errors[c.code] = "Son noto'g'ri";
      else if (n < 0) errors[c.code] = "Manfiy bo'lmasin";
    }
    return errors;
  }, [expenses, batchCategories]);

  const batchEstimateTotal = useMemo(
    () => batchCategories.reduce((sum, c) => sum + (parseInputNumber(expenses[c.code] ?? '') ?? 0), 0),
    [expenses, batchCategories],
  );

  const preview = useMemo(
    () => previewBatch(lines.map(draftToPreview), batchEstimateTotal),
    [lines, batchEstimateTotal],
  );

  const products = useActiveProducts();
  /** Landed unit cost per model, in the order the models first appear (lines of one model are merged). */
  const modelCosts = useMemo(() => {
    const names = new Map((products.data ?? []).map((p) => [p.id, p.name]));
    const rows: { productId: number; name: string; qty: number; total: number; unit: number; extra: number; overhead: number }[] = [];
    lines.forEach((line, i) => {
      const result = preview.lines[i];
      if (line.product_id === null || !result) return;
      const qty = Math.max(draftToPreview(line).qty, 0);
      let row = rows.find((r) => r.productId === line.product_id);
      if (!row) {
        row = { productId: line.product_id, name: names.get(line.product_id) ?? `#${line.product_id}`, qty: 0, total: 0, unit: 0, extra: 0, overhead: 0 };
        rows.push(row);
      }
      row.qty += qty;
      row.total += result.total_cost_est;
      row.extra += result.overhead_est * qty;
      row.unit = row.qty > 0 ? row.total / row.qty : result.unit_cost_est;
      row.overhead = row.qty > 0 ? row.extra / row.qty : result.overhead_est;
    });
    return rows;
  }, [lines, preview, products.data]);

  const lineErrors = useMemo(() => lines.map(validateDraft), [lines]);
  const invalidLines = lineErrors.filter(hasErrors).length;
  const formInvalid =
    !dateValid || invalidLines > 0 || Object.keys(expenseErrors).length > 0 || existingBatch !== undefined;

  const mutation = useMutation({
    mutationFn: (body: BatchIn) => createBatch(body),
    onSuccess: (detail) => {
      queryClient.setQueryData(batchKeys.detail(detail.id), detail);
      void invalidateLedger(queryClient);
      toast.success(`Partiya ${fmtDate(detail.batch_date)} saqlandi`);
      navigate(`/batches/${detail.id}`, { state: { sendTelegram: true } }); // the cost picture goes to Telegram next
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    // Reveal hidden fields that carry errors.
    const hiddenErrors = lines
      .filter((_line, i) => {
        const err = lineErrors[i];
        return err.client_id || err.service_pct || err.perevod_pct || err.cargo || err.imei ||
          err.airport_road || err.inspector || err.bu || err.packaging || err.sim;
      })
      .map((l) => l.key);
    if (hiddenErrors.length > 0) {
      setExpanded((prev) => new Set([...prev, ...hiddenErrors]));
    }
    if (formInvalid) return;

    const expenseRows: ExpenseIn[] = batchCategories
      .map((c) => ({ code: c.code, amount: parseInputNumber(expenses[c.code] ?? '') ?? 0 }))
      .filter((x) => x.amount > 0)
      .map((x) => ({ category: x.code, kind: 'estimate', amount_usd: x.amount }));

    mutation.mutate({
      batch_date: date,
      lines: lines.map(draftToLineIn),
      expenses: expenseRows,
    });
  };

  return (
    <form onSubmit={onSubmit} noValidate>
      <PageHeader
        title="Yangi xarid"
        subtitle="Bir sana — bitta partiya. Tannarx hozircha taxminiy; real xarajatlar partiya sahifasida kiritiladi."
        back={{ to: '/batches', label: 'Partiyalar' }}
      />

      <div className="space-y-4 pb-20">
        <Card title="Partiya" padded>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[200px]">
            <Field
              label="Xarid sanasi"
              htmlFor="batch-date"
              required
              error={submitted && !dateValid ? 'Sanani kiriting' : null}
            >
              <Input
                id="batch-date"
                type="date"
                value={date}
                invalid={submitted && !dateValid}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
          </div>
          {existingBatch && (
            <Alert tone="warning" className="mt-3" title={`${fmtDate(existingBatch.batch_date)} sanasida partiya allaqachon bor`}>
              Bir sanada faqat bitta partiya bo'ladi. Yangi qatorlarni{' '}
              <Link className="font-medium underline" to={`/batches/${existingBatch.id}`}>
                o'sha partiyaga qo'shing
              </Link>{' '}
              yoki boshqa sana tanlang.
            </Alert>
          )}
        </Card>

        <Card
          title="Qatorlar"
          subtitle="Rastamojka tarif bo'yicha avtomatik to'ldiriladi; qo'lda o'zgartirish mumkin."
          actions={
            <span className="hidden md:contents">
              <Button size="sm" variant="subtle" icon={<PlusIcon className="h-3.5 w-3.5" />} onClick={addLine}>
                Qator qo'shish
              </Button>
            </span>
          }
        >
          <div className="px-3 py-2">
            <div className={`${LINE_GRID} hidden border-b border-slate-200 pb-1.5 text-[12px] font-medium text-slate-500 lg:grid`}>
              <div>Mahsulot</div>
              <div>Kanal</div>
              <div className="text-right">Soni</div>
              <div className="text-right">Narx (AED)</div>
              <div className="text-right">Kurs</div>
              <div className="text-right">Rastamojka ($)</div>
              <div className="text-right">Ustama/dona</div>
              <div className="text-right">Tannarx/dona</div>
              <div />
            </div>
            <div className="divide-y divide-slate-100">
              {lines.map((line, idx) => (
                <LineRow
                  key={line.key}
                  index={idx}
                  draft={line}
                  date={date}
                  channels={channels}
                  clients={activeClients}
                  clientsLoading={clients.isPending}
                  errors={submitted ? lineErrors[idx] : NO_ERRORS}
                  preview={preview.lines[idx]}
                  expanded={expanded.has(line.key)}
                  canRemove={lines.length > 1}
                  onPatchLine={patchLine}
                  onRemove={removeLine}
                  onDuplicate={duplicateLine}
                  onToggle={toggleExpanded}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2">
              <Button size="sm" variant="ghost" icon={<PlusIcon className="h-3.5 w-3.5" />} onClick={addLine}>
                Qator qo'shish
              </Button>
              <div className="text-xs text-slate-600">
                {fmtQty(lines.length)} qator · <span className="font-semibold">{fmtQty(preview.total_qty)}</span> dona ·
                narx jami <span className="font-semibold tabular-nums">{fmtUsd(preview.price_usd_total, { symbol: true })}</span>
              </div>
            </div>
          </div>
        </Card>

        <Card
          title="Partiya xarajatlari (taxminiy)"
          subtitle="Partiya bo'yicha jami summa ($). Barcha qatorlar (o'z va mijoz) soniga teng bo'linadi. Standart qiymatlar bilan to'ldirilgan — shu partiya uchun o'zgartirish mumkin."
          padded
          actions={
            <Button size="sm" variant="ghost" onClick={() => setExpenses(defaultExpenses(settings, batchCategories))}>
              Standartga qaytarish
            </Button>
          }
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {batchCategories.map((c) => (
              <Field key={c.code} label={`${c.label} ($)`} htmlFor={`exp-${c.code}`} error={expenseErrors[c.code]}>
                <NumberInput
                  id={`exp-${c.code}`}
                  value={expenses[c.code] ?? ''}
                  placeholder="0"
                  invalid={Boolean(expenseErrors[c.code])}
                  onChange={(e) => setExpenses((prev) => ({ ...prev, [c.code]: e.target.value }))}
                />
              </Field>
            ))}
          </div>
          <div className="mt-3 text-xs text-slate-600">
            Jami: <span className="font-semibold tabular-nums">{fmtUsd(batchEstimateTotal, { symbol: true })}</span>
            {preview.total_qty > 0 && (
              <>
                {' '}· dona boshiga{' '}
                <span className="font-semibold tabular-nums">{fmtUsd(preview.batch_share_per_unit, { symbol: true })}</span>
              </>
            )}
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Jami dona" value={fmtQty(preview.total_qty)} />
          <StatCard label="Narx jami" value={fmtUsd(preview.price_usd_total, { symbol: true })} />
          <StatCard label="Partiya xarajati / dona" value={fmtUsd(preview.batch_share_per_unit, { symbol: true })} />
          <StatCard label="O'rt. ustama / dona" value={fmtUsd(preview.overhead_per_unit_avg, { symbol: true })} />
          <StatCard
            label="O'rt. tannarx / dona"
            value={fmtUsd(preview.total_qty > 0 ? preview.cost_est_total / preview.total_qty : 0, { symbol: true })}
          />
          <StatCard label="Taxminiy tannarx jami" value={fmtUsd(preview.cost_est_total, { symbol: true })} />
        </div>

        {modelCosts.length > 0 && (
          <>
            <ListSection
              className="pt-2 md:hidden"
              header="Model bo'yicha tannarx"
              footer="Bitta telefonga tushgan taxminiy tannarx: narx + ustama + partiya xarajati ulushi."
            >
              {modelCosts.map((m) => (
                <ListRow
                  key={m.productId}
                  title={<span className="line-clamp-2 whitespace-normal">{m.name}</span>}
                  value={
                    <>
                      <span className="font-normal text-slate-500">{fmtQty(m.qty)} dona × </span>
                      {fmtUsdUp(m.unit)}
                      <span className="block text-xs font-normal text-slate-500">xarajat +{fmtUsd(m.overhead, { symbol: true })} / dona</span>
                    </>
                  }
                  valueStrong
                />
              ))}
            </ListSection>
            <Card
              className="hidden max-w-xl md:block"
              title="Model bo'yicha tannarx"
              subtitle="Bitta telefonga tushgan taxminiy tannarx: narx + ustama + partiya xarajati ulushi."
            >
              <div className="divide-y divide-slate-100 px-4">
                {modelCosts.map((m) => (
                  <div key={m.productId} className="flex items-baseline justify-between gap-3 py-2.5">
                    <div className="min-w-0 truncate font-medium text-slate-900">{m.name}</div>
                    <div className="shrink-0 text-right text-[17px] tabular-nums">
                      <span className="mr-3 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                        xarajat +{fmtUsd(m.overhead, { symbol: true })}
                      </span>
                      <span className="text-slate-500">{fmtQty(m.qty)} dona × </span>
                      <span className="font-semibold text-slate-900">{fmtUsdUp(m.unit)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-black/[0.06] bg-canvas/80 backdrop-blur-2xl backdrop-saturate-150 pb-[env(safe-area-inset-bottom)] dark:border-white/[0.08] lg:left-[272px]">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-2 px-4 pb-3 pt-2.5 md:flex-row md:flex-wrap md:items-center md:justify-end md:gap-3 md:pb-2.5 lg:px-6">
          <div className="min-w-0 text-center text-xs md:mr-auto md:text-left">
            {mutation.isError ? (
              <span className="text-danger-600">{errorMessage(mutation.error)}</span>
            ) : submitted && formInvalid ? (
              <span className="text-danger-600">
                {existingBatch
                  ? 'Bu sanada partiya mavjud'
                  : invalidLines > 0
                    ? `${invalidLines} ta qatorda xato bor — belgilangan maydonlarni to'ldiring`
                    : "Maydonlarni tekshiring"}
              </span>
            ) : (
              <span className="text-slate-500">Hisob-kitob taxminiy; saqlangach server qayta hisoblaydi.</span>
            )}
          </div>
          <div className="flex gap-2 md:gap-3">
            <ButtonLink to="/batches" className="flex-1 max-md:h-11 max-md:text-[15px] md:flex-none">
              Bekor qilish
            </ButtonLink>
            <Button
              type="submit"
              variant="primary"
              loading={mutation.isPending}
              className="flex-1 max-md:h-11 max-md:text-[15px] md:flex-none"
            >
              Partiyani saqlash
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}

interface LineRowProps {
  index: number;
  draft: LineDraft;
  date: ISODate;
  channels: Channel[];
  clients: Customer[];
  clientsLoading: boolean;
  errors: DraftErrors;
  preview: PreviewLineResult | undefined;
  expanded: boolean;
  canRemove: boolean;
  onPatchLine: (key: string, patch: LineDraftPatch) => void;
  onRemove: (key: string) => void;
  onDuplicate: (key: string) => void;
  onToggle: (key: string) => void;
}

const LineRow = memo(function LineRow({
  index,
  draft,
  date,
  channels,
  clients,
  clientsLoading,
  errors,
  preview,
  expanded,
  canRemove,
  onPatchLine,
  onRemove,
  onDuplicate,
  onToggle,
}: LineRowProps) {
  const onPatch = useCallback((patch: LineDraftPatch) => onPatchLine(draft.key, patch), [onPatchLine, draft.key]);
  const idPrefix = `l${index}`;
  const hiddenError = Boolean(
    errors.client_id || errors.service_pct || errors.perevod_pct || errors.cargo || errors.imei ||
      errors.airport_road || errors.inspector || errors.bu || errors.packaging || errors.sim,
  );

  return (
    <div className="py-3 lg:py-2">
      <div className={LINE_GRID}>
        <GridCell label="Mahsulot" className="col-span-2 sm:col-span-3 lg:col-span-1">
          <ProductSelect
            id={`${idPrefix}-product`}
            value={draft.product_id}
            onChange={(id) => onPatch({ product_id: id, rastamojka_manual: false })}
            invalid={Boolean(errors.product_id)}
          />
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
            <span>#{index + 1}</span>
            {draft.is_client && <Badge tone="primary">Mijoz uchun</Badge>}
            {errors.product_id && <span className="text-danger-600">{errors.product_id}</span>}
          </div>
        </GridCell>
        <GridCell label="Kanal">
          <Select
            aria-label="Kanal"
            value={draft.channel_id ?? ''}
            onChange={(e) => onPatch({ channel_id: e.target.value ? Number(e.target.value) : null })}
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </GridCell>
        <GridCell label="Soni">
          <NumberInput
            aria-label="Soni"
            inputMode="numeric"
            value={draft.qty}
            invalid={Boolean(errors.qty)}
            title={errors.qty}
            onChange={(e) => onPatch({ qty: e.target.value })}
          />
        </GridCell>
        <GridCell label="Narx (AED)">
          <NumberInput
            aria-label="Narx (AED)"
            value={draft.price_aed}
            invalid={Boolean(errors.price_aed)}
            title={errors.price_aed}
            onChange={(e) => onPatch({ price_aed: e.target.value })}
          />
        </GridCell>
        <GridCell label="Kurs">
          <NumberInput
            aria-label="Kurs"
            value={draft.rate}
            invalid={Boolean(errors.rate)}
            title={errors.rate}
            onChange={(e) => onPatch({ rate: e.target.value })}
          />
        </GridCell>
        <GridCell label="Rastamojka ($)">
          <RastamojkaInput draft={draft} date={date} onPatch={onPatch} error={errors.rastamojka} compact />
        </GridCell>
        <GridCell label="Ustama/dona">
          <div className="tabular-nums text-slate-700 lg:pt-1.5 lg:text-right">{fmtUsd(preview?.overhead_est)}</div>
        </GridCell>
        <GridCell label="Tannarx/dona">
          <div className="tabular-nums lg:pt-1.5 lg:text-right">
            <div className="font-semibold text-slate-900">{fmtUsd(preview?.unit_cost_est)}</div>
            {preview && preview.price_usd > 0 && (
              <div className="text-[11px] text-slate-500">narx {fmtUsd(preview.price_usd)}</div>
            )}
          </div>
        </GridCell>
        <div className="col-span-2 flex items-center justify-end gap-0.5 sm:col-span-3 lg:col-span-1 lg:pt-1">
          <IconButton
            label="Qo'shimcha xarajatlar"
            onClick={() => onToggle(draft.key)}
            className={hiddenError ? 'text-danger-500' : ''}
          >
            {expanded ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
          </IconButton>
          <IconButton label="Nusxa olish (shu narx va xarajatlar bilan)" onClick={() => onDuplicate(draft.key)}>
            <CopyIcon className="h-4 w-4" />
          </IconButton>
          <IconButton label="Qatorni o'chirish" tone="danger" disabled={!canRemove} onClick={() => onRemove(draft.key)}>
            <TrashIcon className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
      {!expanded && (
        <button
          type="button"
          onClick={() => onToggle(draft.key)}
          className={`mt-1 text-[11px] font-medium hover:underline ${hiddenError ? 'text-danger-600' : 'text-primary-600'}`}
        >
          Qo'shimcha: perevod {draft.perevod_pct || 0}%, kargo {draft.cargo || 0}, IMEI {draft.imei || 0}
          {draft.is_client ? ', mijoz' : ''} …
        </button>
      )}
      {expanded && (
        <div className="mt-2 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div>
            <div className="mb-2 text-xs font-semibold text-slate-700">Qo'shimcha xarajatlar (dona uchun)</div>
            <ExtraCostFields draft={draft} onPatch={onPatch} errors={errors} idPrefix={idPrefix} />
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ClientFields
              draft={draft}
              onPatch={onPatch}
              errors={errors}
              clients={clients}
              clientsLoading={clientsLoading}
              idPrefix={idPrefix}
            />
            <Field label="Qator izohi" htmlFor={`${idPrefix}-note`}>
              <Input id={`${idPrefix}-note`} value={draft.note} onChange={(e) => onPatch({ note: e.target.value })} />
            </Field>
          </div>
          {draft.is_client && preview?.charge_per_unit !== null && preview?.charge_per_unit !== undefined && (
            <div className="text-xs text-slate-600">
              Mijozga hisob (taxminiy):{' '}
              <span className="font-semibold tabular-nums">{fmtUsd(preview.charge_per_unit, { symbol: true })}</span> / dona
            </div>
          )}
        </div>
      )}
    </div>
  );
});

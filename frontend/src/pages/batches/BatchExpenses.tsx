import { useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { addExpense, deleteExpense, type BatchDetail, type BatchExpense, type ExpenseIn } from '../../api/batches';
import { errorMessage } from '../../api/client';
import type { Category } from '../../api/meta';
import type { CategoryCode, ExpenseKind } from '../../api/types';
import { Can } from '../../components/Can';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, TableWrap } from '../../components/ui/Card';
import { ListRow, ListSection } from '../../components/ui/List';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { PlusIcon, TrashIcon } from '../../components/ui/icons';
import { Field, Input, NumberInput, Select } from '../../components/ui/Input';
import { EXPENSE_KIND_LABELS, LEVEL_LABELS, categoryLabel } from '../../lib/categories';
import { fmtDateTime, fmtSignedUsd, fmtUsd, parseInputNumber, signClass, toNum } from '../../lib/format';

const EXPENSES_NOTE =
  "Kategoriya bo'yicha real summa kiritilsa, tannarxda taxminiy o'rniga real ishlatiladi. Qator xarajatlarining real summasi qatorlarga taxminiy ulushiga mutanosib, partiya xarajatlari esa har bir donaga teng bo'linadi.";

interface BatchExpensesProps {
  batch: BatchDetail;
  /** From `GET /meta/categories` (falls back to the batch's own category list). */
  categories: Category[];
  onChanged: (detail: BatchDetail) => void;
}

export function BatchExpenses({ batch, categories, onChanged }: BatchExpensesProps) {
  const totalQty = batch.total_qty;

  const summary = useMemo(() => {
    let est = 0;
    let act = 0;
    let eff = 0;
    for (const c of batch.categories) {
      est += toNum(c.estimate_total);
      act += toNum(c.actual_total);
      eff += toNum(c.effective_total);
    }
    return { est, act, eff };
  }, [batch.categories]);

  const sortedExpenses = useMemo(
    () => [...batch.expenses].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [batch.expenses],
  );

  const [toDelete, setToDelete] = useState<BatchExpense | null>(null);
  const del = useMutation({
    mutationFn: (expenseId: number) => deleteExpense(batch.id, expenseId),
    onSuccess: (detail) => {
      setToDelete(null);
      onChanged(detail);
    },
  });

  return (
    <>
      {/* iPhone: categories, the add form and the entries as inset-grouped sections */}
      <div className="space-y-8 pt-4 md:hidden">
        <ListSection header="Partiya xarajatlari" footer={EXPENSES_NOTE}>
          {batch.categories.map((c) => {
            const hasActual = c.actual_total !== null;
            const diff = hasActual ? toNum(c.actual_total) - toNum(c.estimate_total) : 0;
            return (
              <ListRow
                key={c.code}
                title={c.label}
                subtitle={`${LEVEL_LABELS[c.level]} · ${fmtUsd(totalQty > 0 ? toNum(c.effective_total) / totalQty : 0, { symbol: true })} / dona`}
                value={fmtUsd(c.effective_total, { symbol: true })}
                valueSub={
                  hasActual ? (
                    <span className={signClass(diff, true)}>real · farq {fmtSignedUsd(diff)}</span>
                  ) : undefined
                }
              />
            );
          })}
          <ListRow
            title={<span className="font-semibold">Jami ustama</span>}
            subtitle={`taxminiy ${fmtUsd(summary.est, { symbol: true })} · real ${fmtUsd(summary.act, { symbol: true })}`}
            value={fmtUsd(summary.eff, { symbol: true })}
            valueStrong
            valueSub={`${fmtUsd(totalQty > 0 ? summary.eff / totalQty : 0, { symbol: true })} / dona`}
          />
        </ListSection>

        <Can do="batches.write">
          <AddExpenseForm batch={batch} categories={categories} onAdded={onChanged} layout="list" idPrefix="m-exp" />
        </Can>

        <ListSection header={`Kiritilgan yozuvlar (${batch.expenses.length})`}>
          {sortedExpenses.length === 0 ? (
            <li className="px-4 py-3 text-[15px] leading-snug text-slate-500">
              Hali xarajat yozuvi yo'q. Real to'lovlar (deklarantdan) shu yerga kiritiladi.
            </li>
          ) : (
            sortedExpenses.map((e) => (
              <li key={e.id} className="pl-4">
                <div className="relative flex min-h-[48px] items-center gap-2 py-[10px] pr-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-3 text-[17px] leading-[22px] tracking-[-0.025em] text-slate-900">
                      <span className="min-w-0 flex-1 truncate">{categoryLabel(e.category, categories)}</span>
                      <span className="shrink-0 tabular-nums">{fmtUsd(e.amount_usd, { symbol: true })}</span>
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-slate-500">
                      <Badge tone={e.kind === 'actual' ? 'success' : 'warning'}>{EXPENSE_KIND_LABELS[e.kind]}</Badge>
                      {e.note && <span className="min-w-0 truncate">{e.note} ·</span>}
                      <span className="shrink-0 tabular-nums">{fmtDateTime(e.created_at)}</span>
                    </div>
                  </div>
                  <Can do="expenses.delete">
                    <IconButton label="O'chirish" tone="danger" onClick={() => setToDelete(e)}>
                      <TrashIcon className="h-[18px] w-[18px]" />
                    </IconButton>
                  </Can>
                  <span className="list-sep pointer-events-none absolute inset-x-0 bottom-0 h-[0.5px] bg-slate-200" />
                </div>
              </li>
            ))
          )}
        </ListSection>
      </div>

    <Card className="hidden md:block" title="Partiya xarajatlari" subtitle={EXPENSES_NOTE}>
      <div className="grid grid-cols-1 gap-0 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:divide-x xl:divide-slate-200">
        <TableWrap>
          <table className="tbl">
            <thead>
              <tr>
                <th>Kategoriya</th>
                <th>Daraja</th>
                <th className="num">Taxminiy jami</th>
                <th className="num">Real jami</th>
                <th className="num">Amaldagi jami</th>
                <th className="num">Farq</th>
                <th className="num">Amaldagi / dona</th>
              </tr>
            </thead>
            <tbody>
              {batch.categories.map((c) => {
                const hasActual = c.actual_total !== null;
                const diff = hasActual ? toNum(c.actual_total) - toNum(c.estimate_total) : 0;
                return (
                  <tr key={c.code}>
                    <td className="font-medium">{c.label}</td>
                    <td className="whitespace-nowrap text-xs text-slate-500">{LEVEL_LABELS[c.level]}</td>
                    <td className="num">{fmtUsd(c.estimate_total)}</td>
                    <td className="num">
                      {hasActual ? fmtUsd(c.actual_total) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="num font-medium">
                      {fmtUsd(c.effective_total)}
                      {hasActual && (
                        <span className="ml-1">
                          <Badge tone="success">real</Badge>
                        </span>
                      )}
                    </td>
                    <td className={`num ${hasActual ? signClass(diff, true) : 'text-slate-300'}`}>
                      {hasActual ? fmtSignedUsd(diff) : '—'}
                    </td>
                    <td className="num">{fmtUsd(totalQty > 0 ? toNum(c.effective_total) / totalQty : 0)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Jami ustama</td>
                <td className="num">{fmtUsd(summary.est)}</td>
                <td className="num">{fmtUsd(summary.act)}</td>
                <td className="num">{fmtUsd(summary.eff)}</td>
                <td className={`num ${signClass(summary.eff - summary.est, true)}`}>
                  {fmtSignedUsd(summary.eff - summary.est)}
                </td>
                <td className="num">{fmtUsd(totalQty > 0 ? summary.eff / totalQty : 0)}</td>
              </tr>
            </tfoot>
          </table>
        </TableWrap>

        <div className="flex min-w-0 flex-col">
          <Can do="batches.write">
            <AddExpenseForm batch={batch} categories={categories} onAdded={onChanged} layout="panel" idPrefix="exp" />
          </Can>
          <div className="border-t border-slate-200 xl:border-t-0">
            <div className="px-4 pb-1 pt-3 text-xs font-semibold text-slate-700">
              Kiritilgan yozuvlar ({batch.expenses.length})
            </div>
            {sortedExpenses.length === 0 ? (
              <div className="px-4 pb-4 text-xs text-slate-500">
                Hali xarajat yozuvi yo'q. Real to'lovlar (deklarantdan) shu yerga kiritiladi.
              </div>
            ) : (
              <TableWrap>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Kategoriya</th>
                      <th>Turi</th>
                      <th className="num">Summa ($)</th>
                      <th>Izoh</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedExpenses.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <div>{categoryLabel(e.category, categories)}</div>
                          <div className="mt-0.5 whitespace-nowrap text-[11.5px] text-slate-500">{fmtDateTime(e.created_at)}</div>
                        </td>
                        <td>
                          <Badge tone={e.kind === 'actual' ? 'success' : 'warning'}>
                            {EXPENSE_KIND_LABELS[e.kind]}
                          </Badge>
                        </td>
                        <td className="num">{fmtUsd(e.amount_usd)}</td>
                        <td className="max-w-[12rem] truncate text-slate-500" title={e.note ?? undefined}>
                          {e.note ?? ''}
                        </td>
                        <td className="w-8 text-right">
                          <Can do="expenses.delete">
                            <IconButton label="O'chirish" tone="danger" onClick={() => setToDelete(e)}>
                              <TrashIcon className="h-4 w-4" />
                            </IconButton>
                          </Can>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </div>
        </div>
      </div>
    </Card>

      <ConfirmDialog
        open={toDelete !== null}
        title="Xarajat yozuvini o'chirish"
        message={
          toDelete && (
            <>
              {categoryLabel(toDelete.category, categories)} · {EXPENSE_KIND_LABELS[toDelete.kind]} ·{' '}
              <span className="font-semibold">{fmtUsd(toDelete.amount_usd, { symbol: true })}</span> o'chirilsinmi?
              Partiya tannarxi qayta hisoblanadi.
            </>
          )
        }
        loading={del.isPending}
        error={del.isError ? errorMessage(del.error) : null}
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
        onClose={() => {
          setToDelete(null);
          del.reset();
        }}
      />
    </>
  );
}

interface AddExpenseFormProps {
  batch: BatchDetail;
  categories: Category[];
  onAdded: (detail: BatchDetail) => void;
  /** `panel`: captioned fields in the desktop card. `list`: iOS form rows (label left, control right). */
  layout: 'panel' | 'list';
  idPrefix: string;
}

/** Borderless control inside an iOS form row: value right-aligned, accent ring only while editing. */
const ROW_CONTROL =
  'h-11 min-w-0 flex-1 border-0 bg-transparent text-right text-[17px] tracking-[-0.02em] focus:outline-none [text-align-last:right]';

function AddExpenseForm({ batch, categories, onAdded, layout, idPrefix }: AddExpenseFormProps) {
  const [kind, setKind] = useState<ExpenseKind>('actual');
  const [category, setCategory] = useState<CategoryCode | ''>('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Line-level estimates live on the lines themselves; only batch-level
  // categories take an estimate total. Actuals are allowed for every category.
  const options = useMemo(
    () => (kind === 'estimate' ? categories.filter((c) => c.level === 'batch') : categories),
    [categories, kind],
  );

  const mutation = useMutation({
    mutationFn: (body: ExpenseIn) => addExpense(batch.id, body),
    onSuccess: (detail) => {
      setAmount('');
      setNote('');
      setError(null);
      onAdded(detail);
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const value = parseInputNumber(amount);
    if (!category) {
      setError('Kategoriyani tanlang');
      return;
    }
    if (value === undefined || value <= 0) {
      setError("Summa 0 dan katta bo'lsin");
      return;
    }
    setError(null);
    mutation.mutate({ category, kind, amount_usd: value, note: note.trim() || null });
  };

  const onKindChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value === 'estimate' ? 'estimate' : 'actual';
    setKind(next);
    if (next === 'estimate' && category && !categories.some((c) => c.code === category && c.level === 'batch')) {
      setCategory('');
    }
  };
  const onCategoryChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const found = options.find((c) => c.code === e.target.value);
    setCategory(found ? found.code : '');
  };
  const categoryInvalid = error === 'Kategoriyani tanlang';
  const amountInvalid = error !== null && !categoryInvalid;

  const kindOptions = (
    <>
      <option value="actual">{EXPENSE_KIND_LABELS.actual} (to'langan)</option>
      <option value="estimate">{EXPENSE_KIND_LABELS.estimate}</option>
    </>
  );
  const categoryOptions = (
    <>
      <option value="">Tanlang…</option>
      {options.map((c) => (
        <option key={c.code} value={c.code}>
          {c.label}
          {c.level === 'line' ? ' (qatorlarga)' : ''}
        </option>
      ))}
    </>
  );
  const failure = (error || mutation.isError) && <Alert tone="danger">{error ?? errorMessage(mutation.error)}</Alert>;

  if (layout === 'list') {
    return (
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <ListSection header="Xarajat qo'shish">
          <FormRow label="Turi" htmlFor={`${idPrefix}-kind`}>
            <select id={`${idPrefix}-kind`} value={kind} onChange={onKindChange} className={`${ROW_CONTROL} pr-6 text-slate-500`}>
              {kindOptions}
            </select>
          </FormRow>
          <FormRow label="Kategoriya" htmlFor={`${idPrefix}-category`} invalid={categoryInvalid}>
            <select
              id={`${idPrefix}-category`}
              value={category}
              aria-invalid={categoryInvalid}
              onChange={onCategoryChange}
              className={`${ROW_CONTROL} pr-6 ${category ? 'text-slate-500' : 'text-slate-400'}`}
            >
              {categoryOptions}
            </select>
          </FormRow>
          <FormRow label="Summa, partiya jami ($)" htmlFor={`${idPrefix}-amount`} invalid={amountInvalid}>
            <input
              id={`${idPrefix}-amount`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              placeholder="0.00"
              aria-invalid={amountInvalid}
              onChange={(e) => setAmount(e.target.value)}
              className={`${ROW_CONTROL} tabular-nums text-slate-900 placeholder:text-slate-400`}
            />
          </FormRow>
          <FormRow label="Izoh" htmlFor={`${idPrefix}-note`}>
            <input
              id={`${idPrefix}-note`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={`${ROW_CONTROL} text-slate-900`}
            />
          </FormRow>
        </ListSection>
        {failure}
        <Button
          type="submit"
          size="lg"
          variant="primary"
          className="w-full"
          loading={mutation.isPending}
          icon={<PlusIcon className="h-4 w-4" />}
        >
          Qo'shish
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 border-t border-slate-200 bg-slate-50/60 p-4 xl:border-t-0" noValidate>
      <div className="text-xs font-semibold text-slate-700">Xarajat qo'shish</div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Turi" htmlFor={`${idPrefix}-kind`}>
          <Select id={`${idPrefix}-kind`} value={kind} onChange={onKindChange}>
            {kindOptions}
          </Select>
        </Field>
        <Field label="Kategoriya" htmlFor={`${idPrefix}-category`}>
          <Select id={`${idPrefix}-category`} value={category} invalid={categoryInvalid} onChange={onCategoryChange}>
            {categoryOptions}
          </Select>
        </Field>
        <Field label="Summa, partiya jami ($)" htmlFor={`${idPrefix}-amount`}>
          <NumberInput
            id={`${idPrefix}-amount`}
            value={amount}
            placeholder="0.00"
            invalid={amountInvalid}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Izoh" htmlFor={`${idPrefix}-note`}>
          <Input id={`${idPrefix}-note`} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      {failure}
      <div className="flex justify-end">
        <Button type="submit" size="sm" variant="primary" loading={mutation.isPending} icon={<PlusIcon className="h-3.5 w-3.5" />}>
          Qo'shish
        </Button>
      </div>
    </form>
  );
}

/** One iOS form row: label on the left, the control fills the rest; separator inset like `ListRow`. */
function FormRow({
  label,
  htmlFor,
  invalid = false,
  children,
}: {
  label: string;
  htmlFor: string;
  invalid?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="pl-4">
      <div className="relative flex min-h-[48px] items-center gap-3 pr-4">
        <label
          htmlFor={htmlFor}
          className={`shrink-0 text-[17px] tracking-[-0.025em] ${invalid ? 'text-danger-600' : 'text-slate-900'}`}
        >
          {label}
        </label>
        {children}
        <span className="list-sep pointer-events-none absolute inset-x-0 bottom-0 h-[0.5px] bg-slate-200" />
      </div>
    </li>
  );
}

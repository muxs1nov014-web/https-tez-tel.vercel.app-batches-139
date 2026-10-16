import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../api/client';
import {
  BATCH_EXPENSE_DEFAULT_KEYS,
  settingsKeys,
  updateSettings,
  type BatchExpenseDefaultKey,
  type Settings,
} from '../../api/settings';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field, NumberInput } from '../../components/ui/Input';
import { ListRow, ListSection } from '../../components/ui/List';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useCan } from '../../lib/auth';
import {
  fmtPct,
  fmtRate,
  fmtUsd,
  fractionToPercentInput,
  numToInput,
  parseInputNumber,
  percentInputToFraction,
} from '../../lib/format';
import { useSettings } from '../../lib/queries';
import { InputRow } from './FormRows';

const TITLE = 'Sozlamalar';
const SUBTITLE =
  "Yangi xarid uchun standart qiymatlar (qatorlar va partiya xarajatlari). O'zgartirish oldingi partiyalarga ta'sir qilmaydi.";
const BATCH_TITLE = 'Partiya xarajatlari — standart (taxminiy, partiya jami $)';
const BATCH_NOTE =
  '"Yangi xarid" sahifasida shu qiymatlar avtomatik to\'ldiriladi; har bir partiyada qo\'lda o\'zgartirish mumkin.';

interface FormState extends Record<BatchExpenseDefaultKey, string> {
  customs_rate: string; // percent
  default_rate: string;
  default_perevod_pct: string; // percent
  default_imei: string;
  default_cargo: string;
}

function toForm(s: Settings): FormState {
  return {
    customs_rate: fractionToPercentInput(s.customs_rate),
    default_rate: numToInput(s.default_rate),
    default_perevod_pct: fractionToPercentInput(s.default_perevod_pct),
    default_imei: numToInput(s.default_imei),
    default_cargo: numToInput(s.default_cargo),
    default_batch_certificate: numToInput(s.default_batch_certificate),
    default_batch_dubai_internal: numToInput(s.default_batch_dubai_internal),
    default_batch_customs_invoice: numToInput(s.default_batch_customs_invoice),
    default_batch_customs_duty: numToInput(s.default_batch_customs_duty),
    default_batch_customs_cash: numToInput(s.default_batch_customs_cash),
    default_batch_declarant: numToInput(s.default_batch_declarant),
  };
}

const FIELDS: { key: keyof FormState; label: string; hint: string }[] = [
  { key: 'customs_rate', label: 'Bojxona stavkasi (%)', hint: 'Rastamojka = bazaviy narx × stavka × kanal koeff.' },
  { key: 'default_rate', label: 'Kurs (AED / $)', hint: 'Yangi qatorlar uchun standart' },
  { key: 'default_perevod_pct', label: 'Perevod (%)', hint: 'Narx $ dan foiz' },
  { key: 'default_imei', label: 'IMEI ($/dona)', hint: 'Standart qiymat' },
  { key: 'default_cargo', label: 'Kargo ($/dona)', hint: 'Standart qiymat' },
];

/** Same labels as the batch-level categories on the new-purchase form. */
const BATCH_EXPENSE_FIELDS: { key: BatchExpenseDefaultKey; label: string }[] = [
  { key: 'default_batch_certificate', label: 'Sertifikat ($)' },
  { key: 'default_batch_dubai_internal', label: 'Dubay ichki ($)' },
  { key: 'default_batch_customs_invoice', label: 'Schet bojxona ($)' },
  { key: 'default_batch_customs_duty', label: 'Bojxona boji ($)' },
  { key: 'default_batch_customs_cash', label: 'Naqd bojxona ($)' },
  { key: 'default_batch_declarant', label: 'Deklarant / hujjatlar ($)' },
];

/**
 * iPhone: iOS Settings-style sections (label left, value right). iPad / Mac: the grouped card with a grid.
 * Both layouts render; breakpoints pick one.
 */
export function SettingsCard() {
  const query = useSettings();
  const canEdit = useCan()('settings.write');

  if (query.isPending || query.isError) {
    const state = query.isPending ? (
      <LoadingState rows={2} />
    ) : (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    );
    return (
      <>
        <ListSection header={TITLE} className="md:hidden">
          <li>{state}</li>
        </ListSection>
        <Card title={TITLE} subtitle={SUBTITLE} className="hidden md:block">
          {state}
        </Card>
      </>
    );
  }

  if (canEdit) return <SettingsForm settings={query.data} />;

  const s = query.data;
  return (
    <>
      <div className="space-y-8 md:hidden">
        <ListSection header={TITLE} footer={SUBTITLE}>
          <ListRow title="Bojxona stavkasi" value={fmtPct(s.customs_rate)} />
          <ListRow title="Kurs (AED / $)" value={fmtRate(s.default_rate)} />
          <ListRow title="Perevod" value={fmtPct(s.default_perevod_pct)} />
          <ListRow title="IMEI ($/dona)" value={fmtUsd(s.default_imei)} />
          <ListRow title="Kargo ($/dona)" value={fmtUsd(s.default_cargo)} />
        </ListSection>
        <ListSection header={BATCH_TITLE}>
          {BATCH_EXPENSE_FIELDS.map((f) => (
            <ListRow key={f.key} title={f.label} value={fmtUsd(s[f.key])} />
          ))}
        </ListSection>
      </div>
      <Card title={TITLE} subtitle={SUBTITLE} className="hidden md:block">
        <dl className="grid grid-cols-2 gap-4 p-4 md:grid-cols-5">
          <ReadOnly label="Bojxona stavkasi" value={fmtPct(query.data.customs_rate)} />
          <ReadOnly label="Kurs (AED / $)" value={fmtRate(query.data.default_rate)} />
          <ReadOnly label="Perevod" value={fmtPct(query.data.default_perevod_pct)} />
          <ReadOnly label="IMEI ($/dona)" value={fmtUsd(query.data.default_imei)} />
          <ReadOnly label="Kargo ($/dona)" value={fmtUsd(query.data.default_cargo)} />
          {BATCH_EXPENSE_FIELDS.map((f) => (
            <ReadOnly key={f.key} label={`Partiya: ${f.label}`} value={fmtUsd(query.data[f.key])} />
          ))}
        </dl>
      </Card>
    </>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function SettingsForm({ settings }: { settings: Settings }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => toForm(settings));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(toForm(settings));
  }, [settings]);

  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(settings));

  const mutation = useMutation({
    mutationFn: (body: Settings) => updateSettings(body),
    onSuccess: (saved) => {
      queryClient.setQueryData(settingsKeys.all, saved);
      void queryClient.invalidateQueries({ queryKey: ['tariffs', 'estimate'] });
      toast.success('Sozlamalar saqlandi');
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const customsRate = percentInputToFraction(form.customs_rate);
    const rate = parseInputNumber(form.default_rate);
    const perevod = percentInputToFraction(form.default_perevod_pct);
    const imei = parseInputNumber(form.default_imei);
    const cargo = parseInputNumber(form.default_cargo);
    const batchExpenses = BATCH_EXPENSE_DEFAULT_KEYS.map((key) => [key, parseInputNumber(form[key])] as const);
    if (batchExpenses.some(([, value]) => value === undefined || value < 0)) {
      setError("Partiya xarajatlariga to'g'ri son kiriting (≥ 0)");
      return;
    }
    if (
      customsRate === undefined ||
      rate === undefined ||
      perevod === undefined ||
      imei === undefined ||
      cargo === undefined ||
      rate <= 0 ||
      customsRate < 0 ||
      customsRate > 1 ||
      perevod < 0 ||
      perevod > 1 ||
      imei < 0 ||
      cargo < 0
    ) {
      setError("Barcha maydonlarga to'g'ri son kiriting (kurs > 0, foizlar 0–100%, qolganlari ≥ 0)");
      return;
    }
    setError(null);
    mutation.mutate({
      customs_rate: customsRate,
      default_rate: rate,
      default_perevod_pct: perevod,
      default_imei: imei,
      default_cargo: cargo,
      ...(Object.fromEntries(batchExpenses) as Record<BatchExpenseDefaultKey, number>),
    });
  };

  const setField = (key: keyof FormState, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const errorText = error ?? (mutation.isError ? errorMessage(mutation.error) : null);

  return (
    <form onSubmit={onSubmit} noValidate>
      {/* iPhone */}
      <div className="space-y-8 md:hidden">
        <ListSection header={TITLE} footer={SUBTITLE}>
          {FIELDS.map((f) => (
            <InputRow
              key={f.key}
              id={`set-m-${f.key}`}
              label={f.label}
              hint={f.hint}
              value={form[f.key]}
              onChange={(v) => setField(f.key, v)}
            />
          ))}
        </ListSection>
        <ListSection header={BATCH_TITLE} footer={BATCH_NOTE}>
          {BATCH_EXPENSE_FIELDS.map((f) => (
            <InputRow
              key={f.key}
              id={`set-m-${f.key}`}
              label={f.label}
              value={form[f.key]}
              onChange={(v) => setField(f.key, v)}
            />
          ))}
        </ListSection>
        <div className="space-y-3">
          {errorText && <Alert tone="danger">{errorText}</Alert>}
          <div className="flex gap-2">
            {dirty && (
              <Button size="lg" className="flex-1" onClick={() => setForm(toForm(settings))} disabled={mutation.isPending}>
                Bekor qilish
              </Button>
            )}
            <Button type="submit" size="lg" variant="primary" className="flex-1" loading={mutation.isPending} disabled={!dirty}>
              Sozlamalarni saqlash
            </Button>
          </div>
        </div>
      </div>

      {/* iPad / Mac */}
      <Card title={TITLE} subtitle={SUBTITLE} className="hidden md:block">
        <div className="p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {FIELDS.map((f) => (
              <Field key={f.key} label={f.label} htmlFor={`set-${f.key}`} hint={f.hint}>
                <NumberInput
                  id={`set-${f.key}`}
                  value={form[f.key]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                />
              </Field>
            ))}
          </div>
          <div className="mb-2 mt-4 text-xs font-semibold text-slate-700">
            Partiya xarajatlari — standart (taxminiy, partiya jami $)
          </div>
          <p className="mb-2 text-xs text-slate-500">
            "Yangi xarid" sahifasida shu qiymatlar avtomatik to'ldiriladi; har bir partiyada qo'lda o'zgartirish mumkin.
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {BATCH_EXPENSE_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} htmlFor={`set-${f.key}`}>
                <NumberInput
                  id={`set-${f.key}`}
                  value={form[f.key]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                />
              </Field>
            ))}
          </div>
          {(error || mutation.isError) && (
            <Alert tone="danger" className="mt-3">
              {error ?? errorMessage(mutation.error)}
            </Alert>
          )}
          <div className="mt-3 flex justify-end gap-2">
            {dirty && (
              <Button onClick={() => setForm(toForm(settings))} disabled={mutation.isPending}>
                Bekor qilish
              </Button>
            )}
            <Button type="submit" variant="primary" loading={mutation.isPending} disabled={!dirty}>
              Sozlamalarni saqlash
            </Button>
          </div>
        </div>
      </Card>
    </form>
  );
}

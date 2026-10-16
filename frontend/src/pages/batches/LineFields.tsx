import { useEffect } from 'react';
import type { Customer } from '../../api/customers';
import type { ISODate } from '../../api/types';
import { Combobox } from '../../components/ui/Combobox';
import { Checkbox, Field, NumberInput } from '../../components/ui/Input';
import { fmtPct, fmtUsd, numToInput, roundTo, toNum } from '../../lib/format';
import {
  PER_UNIT_FIELDS,
  useTariffEstimate,
  type PerUnitField,
  type DraftErrors,
  type LineDraft,
  type LineDraftPatch,
} from './lineDraft';

interface RastamojkaInputProps {
  draft: LineDraft;
  date: ISODate;
  onPatch: (patch: LineDraftPatch) => void;
  error?: string;
  /** Compact = inside a grid row: hint shown as tooltip + small text. */
  compact?: boolean;
  id?: string;
}

/**
 * Rastamojka per unit. Auto-filled from `GET /tariffs/estimate` whenever
 * product / channel / date change, until the user types a value.
 */
export function RastamojkaInput({ draft, date, onPatch, error, compact = false, id }: RastamojkaInputProps) {
  const estimate = useTariffEstimate(draft.product_id, draft.channel_id, date);
  const data = estimate.data;

  useEffect(() => {
    if (!data || draft.rastamojka_manual) return;
    // No tariff: leave blank (= omitted), so the server applies its estimate and reports a warning.
    const next = data.base_price_usd === null ? '' : numToInput(roundTo(toNum(data.rastamojka), 2));
    if (next !== draft.rastamojka) onPatch({ rastamojka: next });
  }, [data, draft.rastamojka_manual, draft.rastamojka, onPatch]);

  const noTariff = data !== undefined && data.base_price_usd === null;
  const hint = data
    ? noTariff
      ? "Tarif topilmadi — qo'lda kiriting"
      : `${fmtUsd(data.base_price_usd)} × ${fmtPct(data.customs_rate)} × ${toNum(data.customs_factor)}`
    : estimate.isFetching
      ? 'Tarif hisoblanmoqda…'
      : estimate.isError
        ? "Tarifni olib bo'lmadi"
        : '';

  const applyTariff = () => {
    if (!data) return;
    onPatch({ rastamojka: numToInput(roundTo(toNum(data.rastamojka), 2)), rastamojka_manual: false });
  };

  const showReset = draft.rastamojka_manual && data !== undefined && !noTariff;

  return (
    <div>
      <NumberInput
        id={id}
        value={draft.rastamojka}
        invalid={Boolean(error)}
        placeholder="avto"
        title={hint || undefined}
        onChange={(e) => onPatch({ rastamojka: e.target.value, rastamojka_manual: true })}
      />
      {(hint || showReset || (!compact && error)) && (
        <div className={`mt-0.5 flex items-center gap-1 text-[11px] ${noTariff ? 'text-warning-700' : 'text-slate-500'}`}>
          {!compact && error ? (
            <span className="text-danger-600">{error}</span>
          ) : (
            <span className="truncate">{hint}</span>
          )}
          {showReset && (
            <button
              type="button"
              onClick={applyTariff}
              className="shrink-0 font-medium text-primary-600 hover:underline"
              title="Tarif bo'yicha qayta hisoblash"
            >
              tarifdan
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function perUnitPatch(key: PerUnitField, value: string): LineDraftPatch {
  const patch: LineDraftPatch = {};
  patch[key] = value;
  return patch;
}

interface ExtraCostFieldsProps {
  draft: LineDraft;
  onPatch: (patch: LineDraftPatch) => void;
  errors: DraftErrors;
  idPrefix: string;
}

/** Perevod % and the per-unit USD costs (defaults come from settings). */
export function ExtraCostFields({ draft, onPatch, errors, idPrefix }: ExtraCostFieldsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
      <Field label="Perevod (%)" htmlFor={`${idPrefix}-perevod`} error={errors.perevod_pct}>
        <NumberInput
          id={`${idPrefix}-perevod`}
          value={draft.perevod_pct}
          invalid={Boolean(errors.perevod_pct)}
          onChange={(e) => onPatch({ perevod_pct: e.target.value })}
        />
      </Field>
      {PER_UNIT_FIELDS.map((f) => (
        <Field key={f.key} label={`${f.label} ($)`} htmlFor={`${idPrefix}-${f.key}`} error={errors[f.key]}>
          <NumberInput
            id={`${idPrefix}-${f.key}`}
            value={draft[f.key]}
            invalid={Boolean(errors[f.key])}
            onChange={(e) => onPatch(perUnitPatch(f.key, e.target.value))}
          />
        </Field>
      ))}
    </div>
  );
}

interface ClientFieldsProps {
  draft: LineDraft;
  onPatch: (patch: LineDraftPatch) => void;
  errors: DraftErrors;
  clients: Customer[];
  clientsLoading: boolean;
  idPrefix: string;
}

/** Client-import-service line: excluded from own stock, charged cost + service fee. */
export function ClientFields({ draft, onPatch, errors, clients, clientsLoading, idPrefix }: ClientFieldsProps) {
  return (
    <div className="space-y-2">
      <Checkbox
        checked={draft.is_client}
        onChange={(checked) => onPatch({ is_client: checked })}
        label="Mijoz uchun xarid (import xizmati, omborga kirmaydi)"
      />
      {draft.is_client && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
          <Field
            label="Mijoz"
            htmlFor={`${idPrefix}-client`}
            error={errors.client_id}
            hint={
              !clientsLoading && clients.length === 0
                ? "Avval «Mijozlar» bo'limida «Mijoz (xizmat)» turidagi mijoz qo'shing"
                : undefined
            }
          >
            <Combobox
              id={`${idPrefix}-client`}
              options={clients.map((c) => ({ id: c.id, label: c.name, hint: c.phone ?? undefined }))}
              value={draft.client_id}
              onChange={(id) => onPatch({ client_id: id })}
              loading={clientsLoading}
              invalid={Boolean(errors.client_id)}
              placeholder="Mijozni tanlang…"
            />
          </Field>
          <Field label="Xizmat haqi (%)" htmlFor={`${idPrefix}-service`} error={errors.service_pct}>
            <NumberInput
              id={`${idPrefix}-service`}
              value={draft.service_pct}
              placeholder="1.5"
              invalid={Boolean(errors.service_pct)}
              onChange={(e) => onPatch({ service_pct: e.target.value })}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

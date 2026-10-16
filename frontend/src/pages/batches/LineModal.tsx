import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { addLine, updateLine, type BatchDetail, type LineIn, type LineOut } from '../../api/batches';
import { errorMessage } from '../../api/client';
import { ProductSelect } from '../../components/ProductSelect';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Field, Input, NumberInput, Select } from '../../components/ui/Input';
import { Modal, ModalBody, ModalFooter } from '../../components/ui/Modal';
import { ErrorState, LoadingState } from '../../components/ui/States';
import type { Channel } from '../../api/channels';
import type { Settings } from '../../api/settings';
import { previewBatch } from '../../lib/costing';
import { fmtDate, fmtQty, fmtUsd } from '../../lib/format';
import { useChannels, useCustomerList, useSettings } from '../../lib/queries';
import { ClientFields, ExtraCostFields, RastamojkaInput } from './LineFields';
import {
  draftFromLine,
  draftToLineIn,
  draftToPreview,
  emptyDraft,
  hasErrors,
  validateDraft,
  type LineDraft,
  type LineDraftPatch,
} from './lineDraft';
import { SHEET_BUTTON } from './sheet';

interface LineModalProps {
  batch: BatchDetail;
  /** Absent = add a new line. */
  line: LineOut | null;
  onClose: () => void;
  onSaved: (detail: BatchDetail) => void;
}

export function LineModal({ batch, line, onClose, onSaved }: LineModalProps) {
  const settings = useSettings();
  const channels = useChannels();
  const title = line ? 'Qatorni tahrirlash' : "Qator qo'shish";
  const subtitle = `Partiya ${fmtDate(batch.batch_date)}${batch.code ? ` · ${batch.code}` : ''}`;

  return (
    <Modal open title={title} subtitle={subtitle} onClose={onClose} size="xl">
      {settings.isPending || channels.isPending ? (
        <ModalBody>
          <LoadingState />
        </ModalBody>
      ) : settings.isError || channels.isError ? (
        <ModalBody>
          <ErrorState
            error={settings.error ?? channels.error}
            onRetry={() => {
              void settings.refetch();
              void channels.refetch();
            }}
          />
        </ModalBody>
      ) : (
        <LineForm
          batch={batch}
          line={line}
          settings={settings.data}
          channels={channels.data}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Modal>
  );
}

interface LineFormProps extends LineModalProps {
  settings: Settings;
  channels: Channel[];
}

function LineForm({ batch, line, settings, channels, onClose, onSaved }: LineFormProps) {
  const defaultChannelId = channels.find((c) => c.code === 'cargo')?.id ?? channels[0]?.id ?? null;
  const [draft, setDraft] = useState<LineDraft>(() => {
    if (line) return draftFromLine(line);
    const fresh = emptyDraft(settings, defaultChannelId);
    // New lines in an existing batch default to the rate already used there.
    const firstRate = batch.lines[0]?.rate;
    if (firstRate !== undefined) fresh.rate = String(Number(firstRate));
    return fresh;
  });
  const [submitted, setSubmitted] = useState(false);

  const clients = useCustomerList({ kind: 'client' });
  const activeClients = useMemo(
    () => (clients.data ?? []).filter((c) => c.is_active || c.id === draft.client_id),
    [clients.data, draft.client_id],
  );

  const onPatch = useCallback((patch: LineDraftPatch) => setDraft((prev) => ({ ...prev, ...patch })), []);

  const errors = validateDraft(draft);
  const shownErrors = submitted ? errors : {};
  const preview = previewBatch([draftToPreview(draft)], 0).lines[0];

  const mutation = useMutation({
    mutationFn: (body: LineIn) => (line ? updateLine(batch.id, line.id, body) : addLine(batch.id, body)),
    onSuccess: onSaved,
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (hasErrors(errors)) return;
    mutation.mutate(draftToLineIn(draft));
  };

  const consignedQty = line ? (line.consigned_qty ?? 0) : 0;
  // Units that already left this line: sold, written off or handed over to customers.
  const soldOrAdjusted = line ? line.sold_qty + line.adjusted_qty + consignedQty : 0;

  return (
    <form onSubmit={onSubmit} noValidate>
      <ModalBody className="space-y-4">
        {line && soldOrAdjusted > 0 && (
          <Alert tone="warning">
            Bu qatordan {fmtQty(line.sold_qty)} dona sotilgan
            {line.adjusted_qty ? `, ${fmtQty(line.adjusted_qty)} dona hisobdan chiqarilgan` : ''}
            {consignedQty ? `, ${fmtQty(consignedQty)} dona mijozlarda` : ''}. Soni{' '}
            {fmtQty(soldOrAdjusted)} dan kam bo'lmasligi kerak; narx o'zgarsa, sotuvlar foydasi qayta hisoblanadi.
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
          <Field label="Mahsulot" htmlFor="line-product" required error={shownErrors.product_id}>
            <ProductSelect
              id="line-product"
              value={draft.product_id}
              ensure={line?.product ?? null}
              onChange={(id) => onPatch({ product_id: id, rastamojka_manual: false })}
              invalid={Boolean(shownErrors.product_id)}
              autoFocus={!line}
            />
          </Field>
          <Field label="Kanal" htmlFor="line-channel">
            <Select
              id="line-channel"
              value={draft.channel_id ?? ''}
              onChange={(e) => onPatch({ channel_id: e.target.value ? Number(e.target.value) : null })}
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Field label="Soni" htmlFor="line-qty" required error={shownErrors.qty}>
            <NumberInput
              id="line-qty"
              inputMode="numeric"
              value={draft.qty}
              invalid={Boolean(shownErrors.qty)}
              onChange={(e) => onPatch({ qty: e.target.value })}
            />
          </Field>
          <Field label="Narx (AED)" htmlFor="line-price" required error={shownErrors.price_aed}>
            <NumberInput
              id="line-price"
              value={draft.price_aed}
              invalid={Boolean(shownErrors.price_aed)}
              onChange={(e) => onPatch({ price_aed: e.target.value })}
            />
          </Field>
          <Field label="Kurs (AED/$)" htmlFor="line-rate" required error={shownErrors.rate}>
            <NumberInput
              id="line-rate"
              value={draft.rate}
              invalid={Boolean(shownErrors.rate)}
              onChange={(e) => onPatch({ rate: e.target.value })}
            />
          </Field>
          <Field label="Narx ($)">
            <div className="flex h-9 items-center justify-end rounded-[9px] bg-slate-100 px-3 text-[16px] tabular-nums text-slate-600 sm:text-[14px]">
              {fmtUsd(preview?.price_usd)}
            </div>
          </Field>
          <Field label="Rastamojka ($/dona)" htmlFor="line-rastamojka">
            <RastamojkaInput
              id="line-rastamojka"
              draft={draft}
              date={batch.batch_date}
              onPatch={onPatch}
              error={shownErrors.rastamojka}
            />
          </Field>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold text-slate-700">Qo'shimcha xarajatlar (dona uchun)</div>
          <ExtraCostFields draft={draft} onPatch={onPatch} errors={shownErrors} idPrefix="line" />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ClientFields
            draft={draft}
            onPatch={onPatch}
            errors={shownErrors}
            clients={activeClients}
            clientsLoading={clients.isPending}
            idPrefix="line"
          />
          <Field label="Izoh" htmlFor="line-note">
            <Input id="line-note" value={draft.note} onChange={(e) => onPatch({ note: e.target.value })} />
          </Field>
        </div>

        <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
          Qator xarajatlari (taxminiy):{' '}
          <span className="font-semibold tabular-nums text-slate-800">{fmtUsd(preview?.line_overhead, { symbol: true })}</span>{' '}
          / dona · tannarx partiya xarajatlari ulushisiz:{' '}
          <span className="font-semibold tabular-nums text-slate-800">{fmtUsd(preview?.unit_cost_est, { symbol: true })}</span>.
          Partiya xarajatlari ulushi saqlangandan so'ng qo'shiladi.
        </div>

        {mutation.isError && <Alert tone="danger">{errorMessage(mutation.error)}</Alert>}
        {submitted && hasErrors(errors) && (
          <Alert tone="danger">Belgilangan maydonlarni to'g'rilang.</Alert>
        )}
      </ModalBody>
      <ModalFooter>
        <Button onClick={onClose} disabled={mutation.isPending} className={SHEET_BUTTON}>
          Bekor qilish
        </Button>
        <Button type="submit" variant="primary" loading={mutation.isPending} className={SHEET_BUTTON}>
          Saqlash
        </Button>
      </ModalFooter>
    </form>
  );
}

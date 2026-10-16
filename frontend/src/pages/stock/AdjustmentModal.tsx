import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../api/client';
import { postAdjustment, type AdjustmentIn, type StockItem, type StockLine } from '../../api/stock';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Field, Input, NumberInput, Select } from '../../components/ui/Input';
import { Modal, ModalBody, ModalFooter } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { fmtDate, fmtQty, fmtUsd, parseInputNumber } from '../../lib/format';
import { invalidateLedger } from '../../lib/queries';

interface AdjustmentModalProps {
  item: StockItem;
  line: StockLine;
  onClose: () => void;
}

type Reason = 'writeoff' | 'correction';

export function AdjustmentModal({ item, line, onClose }: AdjustmentModalProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState<Reason>('writeoff');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: AdjustmentIn) => postAdjustment(body),
    onSuccess: () => {
      void invalidateLedger(queryClient);
      toast.success('Qoldiq tuzatildi');
      onClose();
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const n = parseInputNumber(qty);
    if (n === undefined || !Number.isInteger(n) || n <= 0) {
      setError('Musbat butun son kiriting');
      return;
    }
    if (n > line.remaining_qty) {
      setError(`Qoldiqdan ko'p: partiyada ${fmtQty(line.remaining_qty)} dona bor`);
      return;
    }
    if (reason === 'correction' && !note.trim()) {
      setError('Tuzatish sababini izohda yozing');
      return;
    }
    setError(null);
    mutation.mutate({ purchase_line_id: line.purchase_line_id, qty: n, reason, note: note.trim() || null });
  };

  return (
    <Modal
      open
      title="Qoldiqni tuzatish"
      subtitle={`${item.product.name} · partiya ${fmtDate(line.batch_date)}`}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} noValidate>
        <ModalBody className="space-y-3">
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-[13px] ring-1 ring-inset ring-slate-200">
            <div>
              <div className="text-xs text-slate-500">Hozirgi qoldiq</div>
              <div className="font-semibold tabular-nums">{fmtQty(line.remaining_qty)} dona</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Tannarx / dona</div>
              <div className="font-semibold tabular-nums">{fmtUsd(line.unit_cost, { symbol: true })}</div>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Sabab" htmlFor="adj-reason">
              <Select
                id="adj-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value === 'correction' ? 'correction' : 'writeoff')}
              >
                <option value="writeoff">Hisobdan chiqarish (brak, yo'qolgan)</option>
                <option value="correction">Tuzatish (sanoqdagi farq)</option>
              </Select>
            </Field>
            <Field
              label="Soni"
              htmlFor="adj-qty"
              hint="Qoldiqni shuncha donaga kamaytiradi"
            >
              <NumberInput
                id="adj-qty"
                inputMode="numeric"
                value={qty}
                invalid={error !== null}
                onChange={(e) => setQty(e.target.value)}
                autoFocus
              />
            </Field>
          </div>
          <Field label="Izoh" htmlFor="adj-note">
            <Input id="adj-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {(error || mutation.isError) && <Alert tone="danger">{error ?? errorMessage(mutation.error)}</Alert>}
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose} disabled={mutation.isPending}>
            Bekor qilish
          </Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            Saqlash
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../api/client';
import { createCustomerPayment, type CustomerPaymentIn, type PaymentKind } from '../../api/customerAccounts';
import type { ISODate, Num } from '../../api/types';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Field, Input, NumberInput, Textarea } from '../../components/ui/Input';
import { Modal, ModalBody, ModalFooter } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { todayISO } from '../../lib/dates';
import { fmtUsd, parseInputNumber, roundTo, signClass, toNum } from '../../lib/format';
import { invalidateLedger } from '../../lib/queries';

interface PaymentModalProps {
  kind: PaymentKind;
  customerId: number;
  customerName: string;
  /** Current debt, to preview the balance after the entry. */
  debt: Num;
  onClose: () => void;
  onSaved: (kind: PaymentKind) => void;
}

export function PaymentModal({ kind, customerId, customerName, debt, onClose, onSaved }: PaymentModalProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [date, setDate] = useState<ISODate>(todayISO());
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isPayment = kind === 'payment';
  const value = parseInputNumber(amount);
  const current = toNum(debt);
  const after = value !== undefined && value > 0 ? current + (isPayment ? -value : value) : null;

  const mutation = useMutation({
    mutationFn: (body: CustomerPaymentIn) => createCustomerPayment(customerId, body),
    onSuccess: (saved) => {
      void invalidateLedger(queryClient);
      toast.success(
        isPayment
          ? `To'lov qabul qilindi: ${fmtUsd(saved.amount_usd, { symbol: true })}`
          : `Boshlang'ich qarz kiritildi: ${fmtUsd(saved.amount_usd, { symbol: true })}`,
      );
      onSaved(kind);
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Sanani kiriting');
      return;
    }
    if (value === undefined || value <= 0) {
      setError("Summa 0 dan katta bo'lsin");
      return;
    }
    setError(null);
    // customer_payments.amount_usd is NUMERIC(14,2).
    mutation.mutate({ payment_date: date, amount_usd: roundTo(value, 2), kind, note: note.trim() || null });
  };

  return (
    <Modal
      open
      title={`${isPayment ? "To'lov qabul qilish" : "Boshlang'ich qarz"} · ${customerName}`}
      subtitle={
        isPayment
          ? "To'lov nasiyani kamaytiradi."
          : "Tizimga o'tishdan oldingi qarz. Nasiyaga qo'shiladi; odatda bir marta kiritiladi."
      }
      onClose={onClose}
    >
      <form onSubmit={onSubmit} noValidate>
        <ModalBody className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Sana" htmlFor="pay-date" required>
              <Input
                id="pay-date"
                type="date"
                value={date}
                invalid={error === 'Sanani kiriting'}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="Summa ($)" htmlFor="pay-amount" required>
              <NumberInput
                id="pay-amount"
                value={amount}
                placeholder="0.00"
                autoFocus
                invalid={error !== null && error !== 'Sanani kiriting'}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Izoh" htmlFor="pay-note" className="sm:col-span-2">
              <Textarea id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[13px]">
            <span className="text-slate-500">
              Joriy nasiya:{' '}
              <span className={`font-medium tabular-nums ${signClass(current, true)}`}>
                {fmtUsd(current, { symbol: true })}
              </span>
            </span>
            {after !== null && (
              <span className="text-slate-500">
                Keyin:{' '}
                <span className={`font-semibold tabular-nums ${signClass(after, true)}`}>
                  {fmtUsd(after, { symbol: true })}
                </span>
              </span>
            )}
          </div>
          {after !== null && after < -0.005 && (
            <Alert tone="info">To'lov nasiyadan ko'p — ortiqcha summa mijozning avansi sifatida qoladi.</Alert>
          )}
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

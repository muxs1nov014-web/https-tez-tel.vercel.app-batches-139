import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../api/client';
import {
  customerAccountKeys,
  deleteCustomerPayment,
  listCustomerPayments,
  type CustomerPayment,
} from '../../api/customerAccounts';
import { Can } from '../../components/Can';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, TableWrap } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { BanknotesIcon, TrashIcon, WalletIcon } from '../../components/ui/icons';
import { ListRow, ListSection } from '../../components/ui/List';
import { EmptyState, LoadingState, QueryView } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useCan } from '../../lib/auth';
import { PAYMENT_KIND_LABELS } from '../../lib/categories';
import { fmtDate, fmtDateTime, fmtQty, fmtUsd, toNum } from '../../lib/format';
import { invalidateLedger } from '../../lib/queries';
import { DeleteControl, EditableHeader } from './mobile';

interface CustomerPaymentsTabProps {
  customerId: number;
  onPay: () => void;
  /** iPhone only: the header has no room for this rare action, so it lives in this tab as a list row. */
  onOpeningDebt: () => void;
}

/** Payments and opening-debt entries, newest first. Admin may delete one. */
export function CustomerPaymentsTab({ customerId, onPay, onOpeningDebt }: CustomerPaymentsTabProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const canDelete = useCan()('customerPayments.delete');
  const query = useQuery({
    queryKey: customerAccountKeys.payments(customerId),
    queryFn: () => listCustomerPayments(customerId),
  });
  const [toDelete, setToDelete] = useState<CustomerPayment | null>(null);
  const [editMode, setEditMode] = useState(false);

  const remove = useMutation({
    mutationFn: (paymentId: number) => deleteCustomerPayment(customerId, paymentId),
    onSuccess: () => {
      setToDelete(null);
      void invalidateLedger(queryClient);
      toast.success("Yozuv o'chirildi, nasiya qayta hisoblandi");
    },
  });

  const empty = (
    <EmptyState
      title="Hali to'lov yo'q"
      description="Mijoz pul to'laganda shu yerga kiriting."
      action={
        <Can do="customerPayments.write">
          <Button size="sm" variant="primary" onClick={onPay}>
            To'lov
          </Button>
        </Can>
      }
    />
  );

  return (
    <>
      {/* iPhone: payments as an inset-grouped list; edit mode shows the delete controls */}
      <div className="space-y-6 md:hidden">
        <QueryView query={query} isEmpty={(rows) => rows.length === 0} empty={empty} loading={<LoadingState />}>
          {(rows) => {
            const paid = rows.filter((r) => r.kind === 'payment').reduce((s, r) => s + toNum(r.amount_usd), 0);
            const opening = rows.filter((r) => r.kind === 'opening_debt').reduce((s, r) => s + toNum(r.amount_usd), 0);
            const editing = editMode && canDelete;
            return (
              <>
                <ListSection
                  header={
                    <EditableHeader
                      label="To'lovlar"
                      editing={editing}
                      canEdit={canDelete}
                      onToggle={() => setEditMode((v) => !v)}
                    />
                  }
                  footer="To'lov nasiyani kamaytiradi; boshlang'ich qarz — tizimga o'tishdan oldingi qarz."
                >
                  {rows.map((p) => (
                    <ListRow
                      key={p.id}
                      icon={editing ? undefined : p.kind === 'payment' ? BanknotesIcon : WalletIcon}
                      tint={p.kind === 'payment' ? 'green' : 'orange'}
                      leading={editing ? <DeleteControl /> : undefined}
                      title={PAYMENT_KIND_LABELS[p.kind]}
                      subtitle={[fmtDate(p.payment_date), p.note].filter(Boolean).join(' · ')}
                      value={fmtUsd(p.amount_usd, { symbol: true })}
                      valueStrong
                      onClick={editing ? () => setToDelete(p) : undefined}
                    />
                  ))}
                </ListSection>
                <ListSection header="Jami">
                  <ListRow
                    title="Jami to'langan"
                    subtitle={`${fmtQty(rows.length)} ta yozuv`}
                    value={fmtUsd(paid, { symbol: true })}
                    valueStrong
                  />
                  {opening > 0 && <ListRow title="Boshlang'ich qarz" value={fmtUsd(opening, { symbol: true })} />}
                </ListSection>
              </>
            );
          }}
        </QueryView>
        <Can do="customerPayments.write">
          <ListSection footer="Tizimga o'tishdan oldingi qarz. Nasiyaga qo'shiladi; odatda bir marta kiritiladi.">
            <ListRow icon={WalletIcon} tint="orange" tone="primary" title="Boshlang'ich qarz" onClick={onOpeningDebt} />
          </ListSection>
        </Can>
      </div>

      <Card
        className="hidden md:block"
        title="To'lovlar"
        subtitle="To'lov nasiyani kamaytiradi; boshlang'ich qarz — tizimga o'tishdan oldingi qarz."
      >
        <QueryView query={query} isEmpty={(rows) => rows.length === 0} empty={empty}>
          {(rows) => {
            const paid = rows.filter((r) => r.kind === 'payment').reduce((s, r) => s + toNum(r.amount_usd), 0);
            const opening = rows.filter((r) => r.kind === 'opening_debt').reduce((s, r) => s + toNum(r.amount_usd), 0);
            return (
              <TableWrap>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Sana</th>
                      <th>Turi</th>
                      <th className="num">Summa ($)</th>
                      <th>Izoh</th>
                      <th>Kiritilgan</th>
                      {canDelete && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id}>
                        <td className="whitespace-nowrap font-medium">{fmtDate(p.payment_date)}</td>
                        <td>
                          <Badge tone={p.kind === 'payment' ? 'success' : 'warning'}>{PAYMENT_KIND_LABELS[p.kind]}</Badge>
                        </td>
                        <td className="num font-medium">{fmtUsd(p.amount_usd)}</td>
                        <td className="max-w-[16rem] truncate text-slate-500" title={p.note ?? undefined}>
                          {p.note ?? ''}
                        </td>
                        <td className="whitespace-nowrap text-xs text-slate-500">{fmtDateTime(p.created_at)}</td>
                        {canDelete && (
                          <td className="w-8 text-right">
                            <IconButton label="O'chirish" tone="danger" onClick={() => setToDelete(p)}>
                              <TrashIcon className="h-4 w-4" />
                            </IconButton>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2}>
                        Jami to'langan <span className="font-normal text-slate-500">({fmtQty(rows.length)} ta yozuv)</span>
                      </td>
                      <td className="num">{fmtUsd(paid)}</td>
                      <td colSpan={canDelete ? 3 : 2} className="text-xs font-normal text-slate-500">
                        {opening > 0 ? `Boshlang'ich qarz: ${fmtUsd(opening, { symbol: true })}` : ''}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </TableWrap>
            );
          }}
        </QueryView>
      </Card>

      <ConfirmDialog
        open={toDelete !== null}
        title="Yozuvni o'chirish"
        message={
          toDelete && (
            <>
              {fmtDate(toDelete.payment_date)} · {PAYMENT_KIND_LABELS[toDelete.kind]} ·{' '}
              <span className="font-semibold">{fmtUsd(toDelete.amount_usd, { symbol: true })}</span> o'chirilsinmi?
              Nasiya qayta hisoblanadi.
            </>
          )
        }
        loading={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : null}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        onClose={() => {
          setToDelete(null);
          remove.reset();
        }}
      />
    </>
  );
}

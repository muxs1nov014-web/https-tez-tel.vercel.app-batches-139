import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../api/client';
import {
  customerAccountKeys,
  deleteCustomerMove,
  listCustomerMoves,
  type ConsignmentMove,
  type CustomerTotals,
} from '../../api/customerAccounts';
import { Can } from '../../components/Can';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, TableWrap } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ArrowLeftIcon, PlusIcon, TrashIcon, TruckIcon } from '../../components/ui/icons';
import { ListRow, ListSection } from '../../components/ui/List';
import { EmptyState, LoadingState, QueryView } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useCan } from '../../lib/auth';
import { MOVE_KIND_LABELS } from '../../lib/categories';
import { fmtDate, fmtDateTime, fmtQty, fmtUsd } from '../../lib/format';
import { invalidateLedger } from '../../lib/queries';
import { DeleteControl, EditableHeader, SubLines } from './mobile';

interface CustomerMovesTabProps {
  customerId: number;
  totals: CustomerTotals;
  onGive: () => void;
}

/** Handover / return documents, newest first. Admin may delete one (refused if its units already moved on). */
export function CustomerMovesTab({ customerId, totals, onGive }: CustomerMovesTabProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const canDelete = useCan()('customerMoves.delete');
  const query = useQuery({
    queryKey: customerAccountKeys.moves(customerId),
    queryFn: () => listCustomerMoves(customerId),
  });
  const [toDelete, setToDelete] = useState<ConsignmentMove | null>(null);
  const [editMode, setEditMode] = useState(false);

  const remove = useMutation({
    mutationFn: (moveId: number) => deleteCustomerMove(customerId, moveId),
    onSuccess: () => {
      setToDelete(null);
      void invalidateLedger(queryClient);
      toast.success("Harakat o'chirildi");
    },
  });

  const summary = `Jami berilgan ${fmtQty(totals.given_qty)} · qaytarilgan ${fmtQty(totals.returned_qty)} · sotilgan ${fmtQty(totals.sold_qty)} dona`;
  const empty = (
    <EmptyState
      title="Hali harakat yo'q"
      description="Mijozga mol berilganda yoki qaytarilganda shu yerda ko'rinadi."
      action={
        <Can do="customerMoves.write">
          <Button size="sm" variant="primary" icon={<PlusIcon className="h-3.5 w-3.5" />} onClick={onGive}>
            Mol berish
          </Button>
        </Can>
      }
    />
  );

  return (
    <>
      {/* iPhone: one row per document, products listed under it; edit mode shows the delete controls */}
      <div className="md:hidden">
        <QueryView query={query} isEmpty={(rows) => rows.length === 0} empty={empty} loading={<LoadingState />}>
          {(rows) => {
            const editing = editMode && canDelete;
            return (
              <ListSection
                header={
                  <EditableHeader
                    label="Harakatlar"
                    editing={editing}
                    canEdit={canDelete}
                    onToggle={() => setEditMode((v) => !v)}
                  />
                }
                footer={summary}
              >
                {rows.map((m) => (
                  <ListRow
                    key={m.id}
                    icon={editing ? undefined : m.kind === 'out' ? TruckIcon : ArrowLeftIcon}
                    tint={m.kind === 'out' ? 'blue' : 'orange'}
                    leading={editing ? <DeleteControl /> : undefined}
                    title={MOVE_KIND_LABELS[m.kind]}
                    subtitle={
                      <SubLines
                        lines={[
                          [fmtDate(m.move_date), m.note].filter(Boolean).join(' · '),
                          ...m.lines.map((l) => (
                            <>
                              {l.product.name}{' '}
                              <span className="whitespace-nowrap">
                                × {fmtQty(Math.abs(l.qty))}
                                {l.price_usd !== null && ` · ${fmtUsd(l.price_usd)} $`}
                              </span>
                            </>
                          )),
                        ]}
                      />
                    }
                    value={`${fmtQty(Math.abs(m.total_qty))} dona`}
                    valueStrong
                    valueSub={m.total_value === null ? undefined : fmtUsd(m.total_value, { symbol: true })}
                    onClick={editing ? () => setToDelete(m) : undefined}
                  />
                ))}
              </ListSection>
            );
          }}
        </QueryView>
      </div>

      <Card className="hidden md:block" title="Harakatlar" subtitle={summary}>
        <QueryView query={query} isEmpty={(rows) => rows.length === 0} empty={empty}>
          {(rows) => (
            <TableWrap>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Sana</th>
                    <th>Turi</th>
                    <th>Mahsulotlar</th>
                    <th className="num">Soni</th>
                    <th className="num">Summa ($)</th>
                    <th>Izoh</th>
                    <th>Kiritilgan</th>
                    {canDelete && <th />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap font-medium">{fmtDate(m.move_date)}</td>
                      <td>
                        <Badge tone={m.kind === 'out' ? 'primary' : 'warning'}>{MOVE_KIND_LABELS[m.kind]}</Badge>
                      </td>
                      <td>
                        <ul className="space-y-0.5">
                          {m.lines.map((l, i) => (
                            <li key={`${l.product.id}-${i}`} className="whitespace-nowrap">
                              {l.product.name}
                              <span className="text-slate-500">
                                {' '}
                                × {fmtQty(Math.abs(l.qty))}
                                {l.price_usd !== null && ` · ${fmtUsd(l.price_usd)} $`}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="num font-medium">{fmtQty(Math.abs(m.total_qty))}</td>
                      <td className="num">
                        {m.total_value === null ? <span className="text-slate-300">—</span> : fmtUsd(m.total_value)}
                      </td>
                      <td className="max-w-[14rem] truncate text-slate-500" title={m.note ?? undefined}>
                        {m.note ?? ''}
                      </td>
                      <td className="whitespace-nowrap text-xs text-slate-500">{fmtDateTime(m.created_at)}</td>
                      {canDelete && (
                        <td className="w-8 text-right">
                          <IconButton label="O'chirish" tone="danger" onClick={() => setToDelete(m)}>
                            <TrashIcon className="h-4 w-4" />
                          </IconButton>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </QueryView>
      </Card>

      <ConfirmDialog
        open={toDelete !== null}
        title="Harakatni o'chirish"
        message={
          toDelete && (
            <>
              {fmtDate(toDelete.move_date)} · {MOVE_KIND_LABELS[toDelete.kind]} ·{' '}
              <span className="font-semibold">{fmtQty(Math.abs(toDelete.total_qty))} dona</span> o'chirilsinmi?{' '}
              {toDelete.kind === 'out'
                ? "Mol omborimizga qaytadi. Shu topshiruvdagi moldan sotilgan yoki qaytarilgan bo'lsa, o'chirib bo'lmaydi."
                : 'Mol yana mijozda hisoblanadi.'}
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

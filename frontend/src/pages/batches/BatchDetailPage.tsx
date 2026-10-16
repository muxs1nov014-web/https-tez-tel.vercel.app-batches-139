import { Fragment, useCallback, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  batchKeys,
  deleteBatch,
  deleteLine,
  getBatch,
  updateBatch,
  type BatchDetail,
  type BatchPatch,
  type LineOut,
} from '../../api/batches';
import { errorMessage } from '../../api/client';
import { Can } from '../../components/Can';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, TableWrap } from '../../components/ui/Card';
import { ListRow, ListSection } from '../../components/ui/List';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ArchiveIcon, BanknotesIcon, ChartIcon, ChevronDownIcon, ChevronRightIcon, CubeIcon, PaperAirplaneIcon, PencilIcon, PlusIcon, ReceiptIcon, TrashIcon, TrendUpIcon } from '../../components/ui/icons';
import { Field, Input, Textarea } from '../../components/ui/Input';
import { Modal, ModalBody, ModalFooter } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { StatCard } from '../../components/ui/StatCard';
import { useToast } from '../../components/ui/Toast';
import { useCan } from '../../lib/auth';
import { fmtAed, fmtDate, fmtQty, fmtRate, fmtUsd, signClass, toNum } from '../../lib/format';
import { invalidateCustomerBalances, useCategories } from '../../lib/queries';
import { BatchExpenses } from './BatchExpenses';
import { LineBreakdown } from './LineBreakdown';
import { LineModal } from './LineModal';
import { LineSheet } from './LineSheet';
import { ModelCostCard } from './ModelCostCard';
import { SendTelegramModal } from './SendTelegramModal';
import { SHEET_BUTTON } from './sheet';

export function BatchDetailPage() {
  const params = useParams();
  const batchId = Number(params.batchId);
  const valid = Number.isInteger(batchId) && batchId > 0;

  const query = useQuery({
    queryKey: batchKeys.detail(batchId),
    queryFn: () => getBatch(batchId),
    enabled: valid,
  });

  const back = { to: '/batches', label: 'Partiyalar' };

  if (!valid) {
    return (
      <div>
        <PageHeader title="Partiya" back={back} />
        <EmptyState title="Partiya topilmadi" description="Havola noto'g'ri." />
      </div>
    );
  }
  if (query.isPending) {
    return (
      <div>
        <PageHeader title="Partiya" back={back} />
        <LoadingState rows={10} />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div>
        <PageHeader title="Partiya" back={back} />
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      </div>
    );
  }
  return <BatchDetailView batch={query.data} />;
}

type LineModalState = { mode: 'add' } | { mode: 'edit'; line: LineOut } | null;

const LINES_NOTE =
  "Amaldagi = kategoriya bo'yicha real xarajat kiritilgan bo'lsa real, aks holda taxminiy. Qatorni bosib xarajatlar tarkibini oching.";

function BatchDetailView({ batch }: { batch: BatchDetail }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const can = useCan();
  const categoriesQuery = useCategories();
  const categories = categoriesQuery.data ?? batch.categories.map(({ code, label, level }) => ({ code, label, level }));

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [lineModal, setLineModal] = useState<LineModalState>(null);
  const [lineToDelete, setLineToDelete] = useState<LineOut | null>(null);
  /** iPhone only: the line whose breakdown sheet is open. */
  const [sheetLineId, setSheetLineId] = useState<number | null>(null);
  const [editHeader, setEditHeader] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Per-model unit cost to Telegram (SPEC §17), to the people picked in the modal. */
  const [sendOpen, setSendOpen] = useState(false);

  /** Every batch mutation returns the fresh BatchDetail; costs changed, so the ledger is stale. */
  const applyDetail = useCallback(
    (detail: BatchDetail | undefined) => {
      if (detail && Array.isArray(detail.lines)) {
        queryClient.setQueryData(batchKeys.detail(detail.id), detail);
      } else {
        void queryClient.invalidateQueries({ queryKey: batchKeys.detail(batch.id) });
      }
      void queryClient.invalidateQueries({ queryKey: ['batches', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      void queryClient.invalidateQueries({ queryKey: ['sales'] });
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
      // Not invalidateLedger: it would refetch the detail that was just set above.
      void invalidateCustomerBalances(queryClient);
    },
    [queryClient, batch.id],
  );

  const removeLine = useMutation({
    mutationFn: (lineId: number) => deleteLine(batch.id, lineId),
    onSuccess: (detail) => {
      setLineToDelete(null);
      applyDetail(detail);
      toast.success("Qator o'chirildi");
    },
  });

  const removeBatch = useMutation({
    mutationFn: () => deleteBatch(batch.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: batchKeys.detail(batch.id) });
      void queryClient.invalidateQueries({ queryKey: ['batches'] });
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
      void invalidateCustomerBalances(queryClient);
      toast.success(`Partiya ${fmtDate(batch.batch_date)} o'chirildi`);
      navigate('/batches', { replace: true });
    },
  });

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allExpanded = batch.lines.length > 0 && batch.lines.every((l) => expanded.has(l.id));
  const t = batch.totals;
  const qty = batch.total_qty;
  const ownQty = batch.lines.filter((l) => !l.client).reduce((s, l) => s + l.qty, 0);
  const remaining = batch.lines.filter((l) => !l.client).reduce((s, l) => s + l.remaining_qty, 0);
  const hasActuals = batch.categories.some((c) => c.actual_total !== null);
  const canEditLines = can('batches.write');
  const canDeleteLines = can('batchLines.delete');
  const canEditHeader = can('batches.write');
  const sheetLine = sheetLineId === null ? undefined : batch.lines.find((l) => l.id === sheetLineId);

  return (
    <div className="space-y-4">
      <PageHeader
        back={{ to: '/batches', label: 'Partiyalar' }}
        // A plain string, so the iPhone navigation bar can show it once the large title scrolls away.
        title={`Partiya ${fmtDate(batch.batch_date)}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {batch.code && <Badge tone="primary">{batch.code}</Badge>}
            {hasActuals ? <Badge tone="success">Real kiritilgan</Badge> : <Badge tone="warning">Faqat taxminiy</Badge>}
            {batch.note && <span className="min-w-0">{batch.note}</span>}
          </span>
        }
        actions={
          // iPhone: these become list rows at the bottom of the page (see "Partiya ma'lumotlari").
          <span className="hidden md:contents">
            <Can do="batches.write">
              <Button
                size="sm"
                icon={<PaperAirplaneIcon className="h-3.5 w-3.5" />}
                disabled={batch.lines.length === 0}
                onClick={() => setSendOpen(true)}
              >
                Telegramga yuborish
              </Button>
              <Button size="sm" icon={<PencilIcon className="h-3.5 w-3.5" />} onClick={() => setEditHeader(true)}>
                Kod / izoh
              </Button>
            </Can>
            <Can do="batches.delete">
              <Button
                size="sm"
                variant="ghost"
                className="text-danger-600 hover:bg-danger-50 hover:text-danger-700"
                icon={<TrashIcon className="h-3.5 w-3.5" />}
                onClick={() => setConfirmDelete(true)}
              >
                O'chirish
              </Button>
            </Can>
          </span>
        }
      />

      {batch.warnings.length > 0 && (
        <Alert tone="warning" title="Ogohlantirishlar">
          <ul className="list-disc space-y-0.5 pl-4">
            {batch.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          icon={CubeIcon}
          tint="brown"
          label="Jami dona"
          value={fmtQty(qty)}
          sub={`o'z ${fmtQty(ownQty)} · mijoz ${fmtQty(qty - ownQty)} · qoldiq ${fmtQty(remaining)}`}
        />
        <StatCard icon={BanknotesIcon} tint="green" label="Narx jami" value={fmtUsd(t.price_usd, { symbol: true })} />
        <StatCard icon={ReceiptIcon} tint="orange" label="Taxminiy tannarx jami" value={fmtUsd(t.cost_est, { symbol: true })} />
        <StatCard
          icon={ChartIcon}
          tint="blue"
          label="Amaldagi tannarx jami"
          value={fmtUsd(t.cost, { symbol: true })}
          sub={
            <span className={signClass(toNum(t.cost) - toNum(t.cost_est), true)}>
              farq {fmtUsd(toNum(t.cost) - toNum(t.cost_est), { symbol: true })}
            </span>
          }
        />
        <StatCard
          icon={ArchiveIcon}
          tint="purple"
          label="Ustama jami (taxm. → amald.)"
          value={fmtUsd(t.overhead, { symbol: true })}
          sub={`taxminiy ${fmtUsd(t.overhead_est, { symbol: true })}`}
        />
        <StatCard
          icon={TrendUpIcon}
          tint="mint"
          label="Ustama / dona (taxm. → amald.)"
          value={fmtUsd(qty > 0 ? toNum(t.overhead) / qty : 0, { symbol: true })}
          sub={`taxminiy ${fmtUsd(qty > 0 ? toNum(t.overhead_est) / qty : 0, { symbol: true })}`}
        />
      </div>

      {/* iPhone: lines as an inset-grouped list; a tap opens the line's breakdown as a sheet */}
      <div className="md:hidden">
        {batch.lines.length === 0 ? (
          <div className="rounded-[18px] bg-surface shadow-card dark:shadow-none">
            <EmptyState
              title="Partiyada qator yo'q"
              description="Qator qo'shing: mahsulot, soni va narx."
              action={
                <Can do="batches.write">
                  <Button size="sm" variant="primary" onClick={() => setLineModal({ mode: 'add' })}>
                    Qator qo'shish
                  </Button>
                </Can>
              }
            />
          </div>
        ) : (
          <ListSection header={`Qatorlar (${batch.lines.length})`} footer={LINES_NOTE}>
            {batch.lines.map((line) => (
              <ListRow
                key={line.id}
                onClick={() => setSheetLineId(line.id)}
                chevron
                title={<span className="line-clamp-2 whitespace-normal">{line.product.name}</span>}
                subtitle={
                  line.client
                    ? `${fmtQty(line.qty)} dona · Mijoz: ${line.client.name}`
                    : `${fmtQty(line.qty)} dona · ${line.channel?.name ?? '—'} · qoldiq ${fmtQty(line.remaining_qty)}`
                }
                value={fmtUsd(line.unit_cost, { symbol: true })}
                valueStrong
                valueSub="dona"
              />
            ))}
            {canEditLines && (
              <ListRow
                title={
                  <span className="inline-flex items-center gap-1.5">
                    <PlusIcon className="h-[18px] w-[18px] [&>path]:stroke-[2]" />
                    Qator qo'shish
                  </span>
                }
                tone="primary"
                onClick={() => setLineModal({ mode: 'add' })}
              />
            )}
          </ListSection>
        )}
      </div>

      <Card
        className="hidden md:block"
        title={`Qatorlar (${batch.lines.length})`}
        subtitle={LINES_NOTE}
        actions={
          <>
            {batch.lines.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setExpanded(allExpanded ? new Set() : new Set(batch.lines.map((l) => l.id)))}
              >
                {allExpanded ? 'Hammasini yopish' : 'Hammasini ochish'}
              </Button>
            )}
            <Can do="batches.write">
              <Button
                size="sm"
                variant="subtle"
                icon={<PlusIcon className="h-3.5 w-3.5" />}
                onClick={() => setLineModal({ mode: 'add' })}
              >
                Qator qo'shish
              </Button>
            </Can>
          </>
        }
      >
        {batch.lines.length === 0 ? (
          <EmptyState
            title="Partiyada qator yo'q"
            description="Qator qo'shing: mahsulot, soni va narx."
            action={
              <Can do="batches.write">
                <Button size="sm" variant="primary" onClick={() => setLineModal({ mode: 'add' })}>
                  Qator qo'shish
                </Button>
              </Can>
            }
          />
        ) : (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th className="w-6" rowSpan={2} />
                  <th rowSpan={2}>Mahsulot</th>
                  <th rowSpan={2}>Kanal</th>
                  <th className="num" rowSpan={2}>Soni</th>
                  <th className="num" rowSpan={2}>Narx (AED)</th>
                  <th className="num" rowSpan={2}>Kurs</th>
                  <th className="num" rowSpan={2}>Narx ($)</th>
                  <th className="!text-center" colSpan={2}>Ustama / dona ($)</th>
                  <th className="!text-center" colSpan={2}>Tannarx / dona ($)</th>
                  <th className="num" rowSpan={2}>Qoldiq</th>
                  {(canEditLines || canDeleteLines) && <th rowSpan={2} />}
                </tr>
                <tr>
                  <th className="num">Taxminiy</th>
                  <th className="num">Amaldagi</th>
                  <th className="num">Taxminiy</th>
                  <th className="num">Amaldagi</th>
                </tr>
              </thead>
              <tbody>
                {batch.lines.map((line) => {
                  const open = expanded.has(line.id);
                  return (
                    <Fragment key={line.id}>
                      <tr className="row-link" onClick={() => toggle(line.id)}>
                        <td className="text-slate-400">
                          {open ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
                        </td>
                        <td>
                          <div className="font-medium text-slate-900">{line.product.name}</div>
                          {(line.client || line.note) && (
                            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                              {line.client && <Badge tone="primary">Mijoz: {line.client.name}</Badge>}
                              {line.note && <span className="truncate">{line.note}</span>}
                            </div>
                          )}
                        </td>
                        <td className="whitespace-nowrap text-slate-600">{line.channel?.name ?? '—'}</td>
                        <td className="num font-medium">{fmtQty(line.qty)}</td>
                        <td className="num">{fmtAed(line.price_aed)}</td>
                        <td className="num text-slate-500">{fmtRate(line.rate)}</td>
                        <td className="num">{fmtUsd(line.price_usd)}</td>
                        <td className="num text-slate-500">{fmtUsd(line.overhead_est)}</td>
                        <td className={`num font-medium ${signClass(toNum(line.overhead) - toNum(line.overhead_est), true)}`}>
                          {fmtUsd(line.overhead)}
                        </td>
                        <td className="num text-slate-500">{fmtUsd(line.unit_cost_est)}</td>
                        <td className="num font-semibold text-slate-900">{fmtUsd(line.unit_cost)}</td>
                        <td className="num">
                          {line.client ? (
                            <span className="text-slate-300">—</span>
                          ) : (
                            <span className={line.remaining_qty === 0 ? 'text-slate-400' : 'font-medium'}>
                              {fmtQty(line.remaining_qty)}
                            </span>
                          )}
                        </td>
                        {(canEditLines || canDeleteLines) && (
                          <td className="w-16 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                            {canEditLines && (
                              <IconButton label="Tahrirlash" onClick={() => setLineModal({ mode: 'edit', line })}>
                                <PencilIcon className="h-4 w-4" />
                              </IconButton>
                            )}
                            {canDeleteLines && (
                              <IconButton label="O'chirish" tone="danger" onClick={() => setLineToDelete(line)}>
                                <TrashIcon className="h-4 w-4" />
                              </IconButton>
                            )}
                          </td>
                        )}
                      </tr>
                      {open && (
                        <tr className="tbl-sub">
                          <td colSpan={canEditLines || canDeleteLines ? 13 : 12} className="!p-0">
                            <LineBreakdown line={line} categories={batch.categories} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td colSpan={2}>Jami</td>
                  <td className="num">{fmtQty(qty)}</td>
                  <td />
                  <td />
                  <td className="num">{fmtUsd(t.price_usd)}</td>
                  <td className="num">{fmtUsd(t.overhead_est)}</td>
                  <td className="num">{fmtUsd(t.overhead)}</td>
                  <td className="num">{fmtUsd(t.cost_est)}</td>
                  <td className="num">{fmtUsd(t.cost)}</td>
                  <td className="num">{fmtQty(remaining)}</td>
                  {(canEditLines || canDeleteLines) && <td />}
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        )}
      </Card>

      <BatchExpenses batch={batch} categories={categories} onChanged={applyDetail} />

      <ModelCostCard batch={batch} />

      {/* iPhone: the header actions, as rows at the end of the page (iOS puts destructive actions last) */}
      <div className="space-y-8 pt-4 md:hidden">
        {(canEditHeader || batch.code || batch.note) && (
          <ListSection header="Partiya ma'lumotlari">
            <ListRow
              title="Kod"
              value={batch.code ?? '—'}
              onClick={canEditHeader ? () => setEditHeader(true) : undefined}
              chevron={canEditHeader}
            />
            <ListRow
              title="Izoh"
              value={<span className="block max-w-[52vw] truncate">{batch.note ?? '—'}</span>}
              onClick={canEditHeader ? () => setEditHeader(true) : undefined}
              chevron={canEditHeader}
            />
          </ListSection>
        )}
        {canEditHeader && batch.lines.length > 0 && (
          <ListSection footer="Model bo'yicha 1 dona tannarx tanlangan odamlarga boradi.">
            <ListRow
              icon={PaperAirplaneIcon}
              tint="telegram"
              title="Telegramga yuborish"
              tone="primary"
              onClick={() => setSendOpen(true)}
            />
          </ListSection>
        )}
        <Can do="batches.delete">
          <ListSection>
            <ListRow title="Partiyani o'chirish" tone="danger" center onClick={() => setConfirmDelete(true)} />
          </ListSection>
        </Can>
      </div>

      {sendOpen && (
        <SendTelegramModal batchId={batch.id} title={`Partiya ${fmtDate(batch.batch_date)}`} onClose={() => setSendOpen(false)} />
      )}

      {sheetLine && (
        <LineSheet
          line={sheetLine}
          categories={batch.categories}
          canEdit={canEditLines}
          canDelete={canDeleteLines}
          onClose={() => setSheetLineId(null)}
          onEdit={() => {
            setSheetLineId(null);
            setLineModal({ mode: 'edit', line: sheetLine });
          }}
          onDelete={() => {
            setSheetLineId(null);
            setLineToDelete(sheetLine);
          }}
        />
      )}

      {lineModal && (
        <LineModal
          batch={batch}
          line={lineModal.mode === 'edit' ? lineModal.line : null}
          onClose={() => setLineModal(null)}
          onSaved={(detail) => {
            applyDetail(detail);
            toast.success(lineModal.mode === 'edit' ? 'Qator saqlandi' : "Qator qo'shildi");
            setLineModal(null);
          }}
        />
      )}

      <ConfirmDialog
        open={lineToDelete !== null}
        title="Qatorni o'chirish"
        message={
          lineToDelete && (
            <>
              <span className="font-medium">{lineToDelete.product.name}</span> × {fmtQty(lineToDelete.qty)} dona
              o'chirilsinmi? Partiya xarajatlari qolgan qatorlarga qayta taqsimlanadi.
            </>
          )
        }
        loading={removeLine.isPending}
        error={removeLine.isError ? errorMessage(removeLine.error) : null}
        onConfirm={() => lineToDelete && removeLine.mutate(lineToDelete.id)}
        onClose={() => {
          setLineToDelete(null);
          removeLine.reset();
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Partiyani o'chirish"
        message={
          <>
            {fmtDate(batch.batch_date)} partiyasi ({fmtQty(qty)} dona, {batch.lines.length} qator, {batch.expenses.length}{' '}
            xarajat yozuvi) butunlay o'chiriladi. Partiyadan sotuv bo'lsa, o'chirib bo'lmaydi.
          </>
        }
        loading={removeBatch.isPending}
        error={removeBatch.isError ? errorMessage(removeBatch.error) : null}
        onConfirm={() => removeBatch.mutate()}
        onClose={() => {
          setConfirmDelete(false);
          removeBatch.reset();
        }}
      />

      {editHeader && (
        <EditHeaderModal
          batch={batch}
          onClose={() => setEditHeader(false)}
          onSaved={(detail) => {
            applyDetail(detail);
            toast.success('Saqlandi');
            setEditHeader(false);
          }}
        />
      )}
    </div>
  );
}

interface EditHeaderModalProps {
  batch: BatchDetail;
  onClose: () => void;
  onSaved: (detail: BatchDetail) => void;
}

function EditHeaderModal({ batch, onClose, onSaved }: EditHeaderModalProps) {
  const [code, setCode] = useState(batch.code ?? '');
  const [note, setNote] = useState(batch.note ?? '');
  const mutation = useMutation({
    mutationFn: (body: BatchPatch) => updateBatch(batch.id, body),
    onSuccess: onSaved,
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate({ code: code.trim() || null, note: note.trim() || null });
  };

  return (
    <Modal open title="Partiya ma'lumotlari" subtitle={`Sana: ${fmtDate(batch.batch_date)}`} onClose={onClose}>
      <form onSubmit={onSubmit}>
        <ModalBody className="space-y-3">
          <Field label="Kod" htmlFor="hdr-code" hint="Partiya raqami, masalan 12 yoki S3">
            <Input id="hdr-code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          </Field>
          <Field label="Izoh" htmlFor="hdr-note">
            <Textarea id="hdr-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {mutation.isError && <Alert tone="danger">{errorMessage(mutation.error)}</Alert>}
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
    </Modal>
  );
}

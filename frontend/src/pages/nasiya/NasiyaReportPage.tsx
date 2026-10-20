import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import type { Customer } from '../../api/customers';
import {
  confirmNasiyaReport,
  deleteNasiyaReport,
  getNasiyaReport,
  linkNasiyaSheet,
  nasiyaKeys,
  rejectNasiyaReport,
  type NasiyaItem,
  type NasiyaKind,
  type NasiyaReportDetail,
  type NasiyaSheet,
} from '../../api/nasiya';
import { Can } from '../../components/Can';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, TableWrap } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Field, Select, Textarea } from '../../components/ui/Input';
import { Modal, ModalBody, ModalFooter } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { StatCard } from '../../components/ui/StatCard';
import { useToast } from '../../components/ui/Toast';
import { useCan } from '../../lib/auth';
import { fmtDate, fmtDateTime, fmtQty, fmtUsd, toNum } from '../../lib/format';
import { useCustomerList } from '../../lib/queries';
import { EventsTable } from './NasiyaPage';
import { EVENT_LABELS, ImeiTrailModal, IssueLevel, KindBadge, StatusBadge } from './shared';

const BACK = { to: '/nasiya?tab=reports', label: 'Hisobotlar' };
const KIND_ORDER: NasiyaKind[] = ['nasiya', 'variant', 'qoldiq', 'sotuv'];

export function NasiyaReportPage() {
  const params = useParams();
  const reportId = Number(params.reportId);
  const valid = Number.isInteger(reportId) && reportId > 0;
  const query = useQuery({ queryKey: nasiyaKeys.report(reportId), queryFn: () => getNasiyaReport(reportId), enabled: valid });

  if (!valid) return <EmptyState title="Hisobot topilmadi" />;
  if (query.isPending) {
    return (
      <div>
        <PageHeader title="Hisobot" back={BACK} />
        <LoadingState rows={10} />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div>
        <PageHeader title="Hisobot" back={BACK} />
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      </div>
    );
  }
  return <ReportView report={query.data} />;
}

function ReportView({ report }: { report: NasiyaReportDetail }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const can = useCan();
  const [dialog, setDialog] = useState<'confirm' | 'force' | 'reject' | 'delete' | null>(null);
  const [trailImei, setTrailImei] = useState<string | null>(null);
  const [showEvents, setShowEvents] = useState(false);
  const customers = useCustomerList();

  const onDone = async (next: NasiyaReportDetail, message: string) => {
    queryClient.setQueryData(nasiyaKeys.report(report.id), next);
    await queryClient.invalidateQueries({ queryKey: nasiyaKeys.all });
    setDialog(null);
    toast.success(message);
  };
  const reviewable = ['pending', 'rejected', 'superseded'].includes(report.status);
  const blockers = [
    report.report_date ? '' : 'sana aniqlanmagan',
    report.unlinked_sheets ? `${report.unlinked_sheets} ta varaq mijozga bog'lanmagan` : '',
    report.error_count ? `${report.error_count} ta xato` : '',
  ].filter(Boolean);

  const title = report.report_date ? `Hisobot ${fmtDate(report.report_date)}` : 'Hisobot';
  return (
    <div className="space-y-6">
      <PageHeader
        back={BACK}
        title={title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusBadge status={report.status} />
            <span>{report.file_name}</span>
            <span>·</span>
            <span>
              {report.source === 'telegram' ? `${report.chat_title || 'Telegram'}: ${report.sent_by}` : `Panel: ${report.sent_by}`}
            </span>
            <span>· {fmtDateTime(report.created_at)}</span>
            {report.reviewed_by && (
              <span>
                · {report.status === 'rejected' ? 'rad etdi' : "ko'rib chiqdi"}: {report.reviewed_by} ({fmtDateTime(report.reviewed_at)})
              </span>
            )}
          </span>
        }
        actions={
          <Can do="nasiya.review">
            {reviewable && report.status !== 'invalid' && (
              <Button variant="primary" disabled={blockers.length > 0} onClick={() => setDialog('confirm')}>
                Tasdiqlash
              </Button>
            )}
            {reviewable && report.error_count > 0 && report.unlinked_sheets === 0 && report.report_date && can('nasiya.force') && (
              <Button onClick={() => setDialog('force')}>Xatolar bilan tasdiqlash</Button>
            )}
            {(report.status === 'pending' || report.status === 'confirmed') && (
              <Button onClick={() => setDialog('reject')}>Rad etish</Button>
            )}
            <Can do="nasiya.delete">
              <Button variant="ghost" onClick={() => setDialog('delete')}>
                O'chirish
              </Button>
            </Can>
          </Can>
        }
      />

      {reviewable && blockers.length > 0 && report.status !== 'invalid' && (
        <Alert tone="warning" title="Tasdiqlashdan oldin">
          {blockers.join(', ')}.{' '}
          {report.error_count > 0 &&
            "Xatolarni Excel'da tuzatib guruhga qayta yuboring (yangi fayl shu kunni almashtiradi) yoki administrator xatolar bilan tasdiqlasin."}
        </Alert>
      )}
      {report.review_note && <Alert tone="info" title="Izoh">{report.review_note}</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Varaqlar (mijozlar)" value={fmtQty(report.sheet_count)} sub={report.unlinked_sheets ? `${report.unlinked_sheets} tasi bog'lanmagan` : 'hammasi bog\'langan'} />
        <StatCard label="Telefonlar" value={fmtQty(report.item_count)} sub="IMEI bo'yicha" />
        <StatCard label="Xatolar" value={fmtQty(report.error_count)} valueClassName={report.error_count ? 'text-danger-600' : 'text-success-700'} sub="tasdiqlashni to'xtatadi" />
        <StatCard label="Diqqat" value={fmtQty(report.warning_count)} valueClassName={report.warning_count ? 'text-warning-700' : 'text-slate-900'} sub="tekshirib ko'ring" />
      </div>

      {report.issues.length > 0 && (
        <Card title="Fayl bo'yicha">
          <IssuesTable issues={report.issues} />
        </Card>
      )}

      {report.diff && (
        <Card
          title={`${fmtDate(report.diff.previous_date)} bilan taqqoslash`}
          subtitle="Oldingi tasdiqlangan kundan beri IMEI bo'yicha nima o'zgardi."
          actions={
            report.diff.events.length > 0 && (
              <Button size="sm" onClick={() => setShowEvents((v) => !v)}>
                {showEvents ? 'Yashirish' : `Hammasini ko'rish (${report.diff.events.length})`}
              </Button>
            )
          }
        >
          {report.diff.counts.length === 0 ? (
            <EmptyState title="O'zgarish yo'q" />
          ) : showEvents ? (
            <EventsTable events={report.diff.events} onImei={setTrailImei} />
          ) : (
            <div className="flex flex-wrap gap-2 p-4">
              {report.diff.counts.map((c) => (
                <span
                  key={c.type}
                  className={`rounded-xl px-3 py-2 text-[13px] ${c.alert ? 'bg-danger-50 text-danger-800' : 'bg-slate-100 text-slate-700'}`}
                >
                  {EVENT_LABELS[c.type]}: <b className="tabular-nums">{fmtQty(c.qty)}</b>
                  {toNum(c.amount) > 0 && <span className="tabular-nums"> · {fmtUsd(c.amount, { symbol: true, decimals: 0 })}</span>}
                </span>
              ))}
            </div>
          )}
        </Card>
      )}

      {report.sheets.map((sheet) => (
        <SheetCard
          key={sheet.id}
          report={report}
          sheet={sheet}
          customers={customers.data ?? []}
          onImei={setTrailImei}
          onLinked={(next) => void onDone(next, `«${sheet.name}» bog'landi`)}
        />
      ))}

      <ConfirmModal
        open={dialog === 'confirm' || dialog === 'force'}
        force={dialog === 'force'}
        report={report}
        onClose={() => setDialog(null)}
        onDone={(next) => void onDone(next, 'Hisobot tasdiqlandi')}
      />
      <RejectModal
        open={dialog === 'reject'}
        report={report}
        onClose={() => setDialog(null)}
        onDone={(next) => void onDone(next, 'Hisobot rad etildi')}
      />
      <DeleteDialog
        open={dialog === 'delete'}
        reportId={report.id}
        onClose={() => setDialog(null)}
        onDone={async () => {
          await queryClient.invalidateQueries({ queryKey: nasiyaKeys.all });
          toast.success("Hisobot o'chirildi");
          navigate('/nasiya?tab=reports');
        }}
      />
      {trailImei && <ImeiTrailModal imei={trailImei} onClose={() => setTrailImei(null)} />}
    </div>
  );
}

function IssuesTable({ issues }: { issues: NasiyaReportDetail['issues'] }) {
  return (
    <TableWrap>
      <table className="tbl">
        <thead>
          <tr>
            <th>Daraja</th>
            <th>Katak</th>
            <th>Muammo</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((i, idx) => (
            <tr key={`${i.code}-${i.cell}-${idx}`}>
              <td>
                <IssueLevel issue={i} />
              </td>
              <td className="whitespace-nowrap font-medium tabular-nums">{i.cell || '—'}</td>
              <td>{i.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

// ---- one sheet = one customer ----
interface ModelGroup {
  kind: NasiyaKind;
  model: string;
  price: number | null;
  items: NasiyaItem[];
}

/** Consecutive phones of one kind, model and price, the way the sheet lists them. */
function groupItems(items: NasiyaItem[]): ModelGroup[] {
  const groups = new Map<string, ModelGroup>();
  for (const it of items) {
    const price = it.price_usd === null ? null : toNum(it.price_usd);
    const key = `${it.kind}|${it.model}|${price}`;
    const g = groups.get(key) ?? { kind: it.kind, model: it.model, price, items: [] };
    g.items.push(it);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

function SheetCard({
  report,
  sheet,
  customers,
  onImei,
  onLinked,
}: {
  report: NasiyaReportDetail;
  sheet: NasiyaSheet;
  customers: Customer[];
  onImei: (imei: string) => void;
  onLinked: (next: NasiyaReportDetail) => void;
}) {
  const groups = useMemo(() => groupItems(sheet.items), [sheet.items]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const nasiya = sheet.totals.filter((t) => t.kind === 'nasiya').reduce((s, t) => s + toNum(t.amount), 0);
  const fileNasiya = sheet.summary.nasiya !== undefined ? Number(sheet.summary.nasiya) : null;
  const nasiyaMatches = fileNasiya === null || Number.isNaN(fileNasiya) || Math.abs(fileNasiya - nasiya) < 0.01;

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {sheet.name}
          {sheet.error_count > 0 && <Badge tone="danger">{sheet.error_count} xato</Badge>}
          {sheet.warning_count > 0 && <Badge tone="warning">{sheet.warning_count} diqqat</Badge>}
        </span>
      }
      subtitle={sheet.sheet_date ? `Varaq sanasi: ${fmtDate(sheet.sheet_date)}${sheet.sheet_date !== report.report_date ? ' (hisobot sanasidan farqli)' : ''}` : undefined}
      actions={<CustomerLink report={report} sheet={sheet} customers={customers} onLinked={onLinked} />}
    >
      <div className="grid gap-x-6 gap-y-2 border-b border-slate-200/70 p-4 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
        {KIND_ORDER.map((kind) => {
          const t = sheet.totals.find((x) => x.kind === kind);
          if (!t) return null;
          return (
            <div key={kind} className="flex items-center justify-between gap-2">
              <KindBadge kind={kind} />
              <span className="tabular-nums">
                {fmtQty(t.qty)} dona{toNum(t.amount) > 0 && <> · <b>{fmtUsd(t.amount, { symbol: true })}</b></>}
              </span>
            </div>
          );
        })}
        {fileNasiya !== null && !Number.isNaN(fileNasiya) && (
          <div className={`flex items-center justify-between gap-2 ${nasiyaMatches ? 'text-success-700' : 'font-semibold text-danger-600'}`}>
            <span>Varaqdagi «Nasiya»</span>
            <span className="tabular-nums">
              {fmtUsd(fileNasiya, { symbol: true })} {nasiyaMatches ? '✓' : '≠ IMEI summasi'}
            </span>
          </div>
        )}
        {sheet.summary.limit && (
          <div className="flex items-center justify-between gap-2 text-slate-600">
            <span>Limit / bo'sh</span>
            <span className="tabular-nums">
              {Number.isNaN(Number(sheet.summary.limit)) ? sheet.summary.limit : fmtUsd(sheet.summary.limit, { decimals: 0 })} /{' '}
              {sheet.summary.available && !Number.isNaN(Number(sheet.summary.available)) ? fmtUsd(sheet.summary.available, { decimals: 0 }) : '—'}
            </span>
          </div>
        )}
        {sheet.paid_note_usd !== null && (
          <div className="flex items-center justify-between gap-2 text-slate-600">
            <span>«$ o'tdi» izohi</span>
            <span className="tabular-nums">{fmtUsd(sheet.paid_note_usd, { symbol: true })}</span>
          </div>
        )}
      </div>

      {sheet.issues.length > 0 && (
        <div className="border-b border-slate-200/70">
          <IssuesTable issues={sheet.issues} />
        </div>
      )}

      {groups.length === 0 ? (
        <EmptyState title="Telefon yo'q" />
      ) : (
        <TableWrap>
          <table className="tbl">
            <thead>
              <tr>
                <th>Holati</th>
                <th>Model</th>
                <th className="num">Narx ($)</th>
                <th className="num">Dona</th>
                <th className="num">Summa ($)</th>
                <th>IMEI</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const key = `${g.kind}|${g.model}|${g.price}`;
                const expanded = open.has(key);
                const qty = g.items.reduce((s, i) => s + i.qty, 0);
                const shown = expanded ? g.items : g.items.slice(0, 3);
                return (
                  <tr key={key}>
                    <td className="align-top">
                      <KindBadge kind={g.kind} />
                    </td>
                    <td className="align-top font-medium">{g.model}</td>
                    <td className={`num align-top ${g.price === null && g.kind !== 'qoldiq' ? 'font-semibold text-danger-600' : ''}`}>
                      {g.price === null ? (g.kind === 'qoldiq' ? '—' : "yo'q") : fmtUsd(g.price)}
                    </td>
                    <td className="num align-top">{fmtQty(qty)}</td>
                    <td className="num align-top">{g.price === null ? '—' : fmtUsd(g.price * qty)}</td>
                    <td className="align-top">
                      <div className="flex max-w-[520px] flex-wrap gap-1">
                        {shown.map((i) =>
                          i.imei ? (
                            <button
                              key={i.id}
                              type="button"
                              title={`${i.cell}${i.marked_date ? ` · belgi: ${fmtDate(i.marked_date)}` : ''}${i.term_days ? ` · ${i.term_days} kunga` : ''}`}
                              onClick={() => onImei(i.imei as string)}
                              className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11.5px] text-slate-700 hover:bg-primary-50 hover:text-primary-700"
                            >
                              {i.imei}
                            </button>
                          ) : (
                            <span key={i.id} className="text-[12px] text-slate-500">
                              IMEI siz ({i.qty} dona, {i.cell})
                            </span>
                          ),
                        )}
                        {g.items.length > 3 && (
                          <button
                            type="button"
                            className="px-1 text-[12px] font-medium text-primary-700 hover:underline"
                            onClick={() =>
                              setOpen((prev) => {
                                const next = new Set(prev);
                                if (next.has(key)) next.delete(key);
                                else next.add(key);
                                return next;
                              })
                            }
                          >
                            {expanded ? 'yig\'ish' : `yana ${g.items.length - 3} ta`}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

function CustomerLink({
  report,
  sheet,
  customers,
  onLinked,
}: {
  report: NasiyaReportDetail;
  sheet: NasiyaSheet;
  customers: Customer[];
  onLinked: (next: NasiyaReportDetail) => void;
}) {
  const toast = useToast();
  const can = useCan();
  const [choosing, setChoosing] = useState(false);
  const mutation = useMutation({
    mutationFn: (customerId: number) => linkNasiyaSheet(report.id, sheet.id, customerId),
    onSuccess: (next) => {
      setChoosing(false);
      onLinked(next);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const taken = new Set(report.sheets.filter((s) => s.id !== sheet.id && s.customer).map((s) => s.customer?.id));
  const active = customers.filter((c) => c.is_active && !taken.has(c.id));

  if (!can('nasiya.review')) {
    return sheet.customer ? <Badge tone="primary">{sheet.customer.name}</Badge> : <Badge tone="warning">Bog'lanmagan</Badge>;
  }
  if (sheet.customer && !choosing) {
    return (
      <span className="flex items-center gap-2">
        <Badge tone="primary">Mijoz: {sheet.customer.name}</Badge>
        <Button size="xs" variant="ghost" onClick={() => setChoosing(true)}>
          O'zgartirish
        </Button>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      {!sheet.customer && sheet.suggested_customer && (
        <Button size="sm" variant="subtle" loading={mutation.isPending} onClick={() => mutation.mutate(sheet.suggested_customer!.id)}>
          «{sheet.suggested_customer.name}» ga bog'lash
        </Button>
      )}
      <div className="w-56">
        <Select
          value=""
          disabled={mutation.isPending}
          onChange={(e) => e.target.value && mutation.mutate(Number(e.target.value))}
          aria-label="Mijozni tanlang"
        >
          <option value="">{sheet.customer ? 'Boshqa mijozni tanlang…' : 'Mijozni tanlang…'}</option>
          {active.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      {sheet.customer && (
        <Button size="xs" variant="ghost" onClick={() => setChoosing(false)}>
          Bekor
        </Button>
      )}
    </span>
  );
}

// ---- dialogs ----
function ConfirmModal({
  open,
  force,
  report,
  onClose,
  onDone,
}: {
  open: boolean;
  force: boolean;
  report: NasiyaReportDetail;
  onClose: () => void;
  onDone: (next: NasiyaReportDetail) => void;
}) {
  const [note, setNote] = useState('');
  const mutation = useMutation({
    mutationFn: () => confirmNasiyaReport(report.id, { force, note: note.trim() || null }),
    onSuccess: onDone,
  });
  return (
    <Modal open={open} title={force ? 'Xatolar bilan tasdiqlash' : 'Hisobotni tasdiqlash'} onClose={onClose}>
      <ModalBody className="space-y-3">
        <p className="text-[13px] text-slate-700">
          {fmtDate(report.report_date)} kuni uchun {fmtQty(report.item_count)} ta telefon nazoratga kiradi.
          {report.status === 'superseded' || report.status === 'rejected' ? '' : ' Shu kunning avvalgi tasdiqlangan fayli bo\'lsa, uning o\'rnini bosadi.'}
        </p>
        {force && (
          <Alert tone="warning">
            Faylda {report.error_count} ta xato bor: narxi yo'q yoki noto'g'ri IMEI li telefonlar hisobda xato ko'rinishi mumkin.
            Sababini izohda yozing.
          </Alert>
        )}
        <Field label={force ? 'Izoh (majburiy)' : 'Izoh'}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
        </Field>
        {mutation.isError && <Alert tone="danger">{errorMessage(mutation.error)}</Alert>}
      </ModalBody>
      <ModalFooter>
        <Button onClick={onClose} disabled={mutation.isPending}>
          Bekor qilish
        </Button>
        <Button variant="primary" loading={mutation.isPending} disabled={force && !note.trim()} onClick={() => mutation.mutate()}>
          Tasdiqlash
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function RejectModal({
  open,
  report,
  onClose,
  onDone,
}: {
  open: boolean;
  report: NasiyaReportDetail;
  onClose: () => void;
  onDone: (next: NasiyaReportDetail) => void;
}) {
  const [note, setNote] = useState('');
  const mutation = useMutation({ mutationFn: () => rejectNasiyaReport(report.id, note.trim() || null), onSuccess: onDone });
  return (
    <Modal open={open} title="Hisobotni rad etish" onClose={onClose}>
      <ModalBody className="space-y-3">
        <p className="text-[13px] text-slate-700">
          Rad etilgan fayl nazoratga kirmaydi.{report.status === 'confirmed' && ' Bu kun tasdiqlangan hisobotsiz qoladi.'}
        </p>
        <Field label="Sababi">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
        </Field>
        {mutation.isError && <Alert tone="danger">{errorMessage(mutation.error)}</Alert>}
      </ModalBody>
      <ModalFooter>
        <Button onClick={onClose} disabled={mutation.isPending}>
          Bekor qilish
        </Button>
        <Button variant="danger" loading={mutation.isPending} onClick={() => mutation.mutate()}>
          Rad etish
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function DeleteDialog({
  open,
  reportId,
  onClose,
  onDone,
}: {
  open: boolean;
  reportId: number;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const mutation = useMutation({ mutationFn: () => deleteNasiyaReport(reportId), onSuccess: onDone });
  return (
    <ConfirmDialog
      open={open}
      title="Hisobotni o'chirish"
      message="Fayl va undagi barcha telefonlar o'chiriladi. Guruhdagi xabar qoladi: «Guruhdan qayta o'qish» uni qayta olmaydi."
      loading={mutation.isPending}
      error={mutation.isError ? errorMessage(mutation.error) : null}
      onConfirm={() => mutation.mutate()}
      onClose={onClose}
    />
  );
}


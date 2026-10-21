import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  getImeiTrail,
  nasiyaKeys,
  type NasiyaEventType,
  type NasiyaIssue,
  type NasiyaKind,
  type NasiyaStatus,
} from '../../api/nasiya';
import { Badge, type Tone } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { TableWrap } from '../../components/ui/Card';
import { SearchIcon } from '../../components/ui/icons';
import { Input } from '../../components/ui/Input';
import { Modal, ModalBody } from '../../components/ui/Modal';
import { EmptyState, QueryView } from '../../components/ui/States';
import { fmtDate, fmtUsd } from '../../lib/format';

export const KIND_LABELS: Record<NasiyaKind, string> = {
  nasiya: 'Nasiya',
  variant: 'Variant',
  qoldiq: 'Qoldiq',
  sotuv: 'Sotuv (to\'landi)',
};

export const KIND_TONES: Record<NasiyaKind, Tone> = {
  nasiya: 'warning',
  variant: 'primary',
  qoldiq: 'slate',
  sotuv: 'success',
};

export const STATUS_LABELS: Record<NasiyaStatus, string> = {
  pending: 'Tekshirilmoqda',
  confirmed: 'Tasdiqlangan',
  rejected: 'Rad etilgan',
  superseded: 'Almashtirilgan',
  invalid: "O'qib bo'lmadi",
};

const STATUS_TONES: Record<NasiyaStatus, Tone> = {
  pending: 'warning',
  confirmed: 'success',
  rejected: 'danger',
  superseded: 'slate',
  invalid: 'danger',
};

export const EVENT_LABELS: Record<NasiyaEventType, string> = {
  new_debt: 'Yangi nasiya',
  qoldiq_to_debt: 'Qoldiqdan nasiyaga',
  paid: "Nasiya to'landi",
  sold_paid: "Qoldiqdan sotildi (to'landi)",
  sold_direct: "Sotildi (to'landi)",
  handover: 'Yangi mol berildi',
  vanished_debt: "Nasiyadan izsiz chiqdi",
  vanished_qoldiq: 'Qoldiqdan izsiz chiqdi',
  debt_to_qoldiq: 'Nasiyadan qoldiqqa qaytdi',
  moved: "Boshqa mijozga o'tdi",
  price_changed: "Narxi o'zgardi",
  reopened: "To'langan telefon qayta chiqdi",
};

/** What each alert means and what to check. */
export const EVENT_HINTS: Partial<Record<NasiyaEventType, string>> = {
  vanished_debt: "Kecha nasiyada edi, bugun faylda yo'q va «Sotuv»da ham ko'rinmaydi. Pul olinganmi?",
  vanished_qoldiq: "Kecha mijoz qoldig'ida edi, bugun hech qayerda yo'q. Qaytarilganmi yoki yozilmay qolganmi?",
  debt_to_qoldiq: 'Nasiyadagi telefon yana qoldiqqa yozilgan.',
  moved: 'Bir mijozdan boshqasiga o\'tgan.',
  price_changed: "Nasiyadagi telefonning narxi kechagidan farq qiladi.",
  reopened: "Kecha «Sotuv» (to'langan) edi, bugun yana nasiya yoki qoldiqda.",
};

export function StatusBadge({ status }: { status: NasiyaStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}

export function KindBadge({ kind }: { kind: NasiyaKind }) {
  return <Badge tone={KIND_TONES[kind]}>{KIND_LABELS[kind]}</Badge>;
}

export function IssueLevel({ issue }: { issue: NasiyaIssue }) {
  return issue.level === 'error' ? <Badge tone="danger">Xato</Badge> : <Badge tone="warning">Diqqat</Badge>;
}

/** Colour of a phone's days in nasiya: yellow up to 2 days, light red up to 5, dark red from 5. */
export function debtAgeClass(days: number): string {
  if (days >= 5) return 'bg-danger-700 text-white';
  if (days > 2) return 'bg-danger-200 text-danger-800';
  return 'bg-yellow-300 text-yellow-950';
}

/** Days in the current state. Nasiya (and variant) by the 2/5-day scale; qoldiq amber from a week, red past a month. */
export function AgeBadge({
  days,
  exact,
  overdue,
  kind,
}: {
  days: number | null;
  exact: boolean;
  overdue: boolean;
  kind?: NasiyaKind;
}) {
  if (days === null) return <span className="text-slate-300">—</span>;
  const label = `${exact ? '' : '≥ '}${days} kun`;
  const title = exact ? undefined : "Birinchi tasdiqlangan kundan beri: haqiqiy muddat bundan uzoq bo'lishi mumkin";
  if (kind === 'nasiya' || kind === 'variant') {
    return (
      <span title={title}>
        <span
          className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-[3px] text-[11.5px] font-medium leading-none ${debtAgeClass(days)}`}
        >
          {label}
        </span>
      </span>
    );
  }
  const tone: Tone = overdue || days > 30 ? 'danger' : days > 7 ? 'warning' : 'slate';
  return (
    <span title={title}>
      <Badge tone={tone}>{label}</Badge>
    </span>
  );
}

/** IMEI search over every confirmed day: where a phone was, in which state, at what price. */
export function ImeiSearch({ initial = '' }: { initial?: string }) {
  const [text, setText] = useState(initial);
  const [imei, setImei] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = text.replace(/\D/g, '');
    if (value.length >= 14) setImei(value);
  };
  return (
    <>
      <form onSubmit={submit} className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="IMEI bo'yicha qidirish (15 raqam)"
          inputMode="numeric"
          className="w-full sm:w-64"
          aria-label="IMEI"
        />
        <Button type="submit" icon={<SearchIcon className="h-4 w-4" />} disabled={text.replace(/\D/g, '').length < 14}>
          Topish
        </Button>
      </form>
      {imei && <ImeiTrailModal imei={imei} onClose={() => setImei(null)} />}
    </>
  );
}

export function ImeiTrailModal({ imei, onClose }: { imei: string; onClose: () => void }) {
  const query = useQuery({ queryKey: nasiyaKeys.imei(imei), queryFn: () => getImeiTrail(imei) });
  return (
    <Modal open title={`IMEI ${imei}`} subtitle="Tasdiqlangan kunlar bo'yicha tarix (yangisi tepada)" onClose={onClose} size="lg">
      <ModalBody className="!px-0">
        <QueryView
          query={query}
          isEmpty={(rows) => rows.length === 0}
          empty={<EmptyState title="Topilmadi" description="Bu IMEI tasdiqlangan hisobotlarda uchramadi." />}
        >
          {(rows) => (
            <TableWrap>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Sana</th>
                    <th>Mijoz</th>
                    <th>Holati</th>
                    <th>Model</th>
                    <th className="num">Narx ($)</th>
                    <th>Katak</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.report_id}-${r.cell}`}>
                      <td className="whitespace-nowrap">
                        <Link to={`/nasiya/reports/${r.report_id}`} className="text-primary-700 hover:underline" onClick={onClose}>
                          {fmtDate(r.date)}
                        </Link>
                      </td>
                      <td>{r.customer?.name ?? r.sheet_name}</td>
                      <td>
                        <KindBadge kind={r.kind} />
                      </td>
                      <td>{r.model}</td>
                      <td className="num">{fmtUsd(r.price_usd)}</td>
                      <td className="text-slate-500">{r.cell}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </QueryView>
      </ModalBody>
    </Modal>
  );
}

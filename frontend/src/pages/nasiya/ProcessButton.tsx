import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import {
  nasiyaKeys,
  processNasiyaReports,
  rescanNasiyaGroup,
  type NasiyaProcessResult,
  type NasiyaRescanResult,
} from '../../api/nasiya';
import type { ISODate } from '../../api/types';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { RefreshIcon } from '../../components/ui/icons';
import { Field, Input } from '../../components/ui/Input';
import { Modal, ModalBody, ModalFooter } from '../../components/ui/Modal';
import { useCan } from '../../lib/auth';
import { startOfMonthISO, todayISO } from '../../lib/dates';
import { fmtDate, fmtQty } from '../../lib/format';

/** Safety stop for the read loop: 25 files a call, so 40 calls cover a thousand files. */
const MAX_ROUNDS = 40;

type Totals = Pick<NasiyaRescanResult, 'checked' | 'created' | 'skipped' | 'failed' | 'confirmed'>;
type Outcome = { read: Totals; process: NasiyaProcessResult; error?: undefined } | { error: string };

/** "Hammasini hisoblash" (SPEC §18.3): read every group file from a day, then confirm each day that needs no decision. */
export function ProcessButton({ variant = 'primary' }: { variant?: 'primary' | 'subtle' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} icon={<RefreshIcon className="h-4 w-4" />} onClick={() => setOpen(true)}>
        Hammasini hisoblash
      </Button>
      {open && <ProcessModal onClose={() => setOpen(false)} />}
    </>
  );
}

function ProcessModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const isAdmin = useCan()('nasiya.force');
  const [since, setSince] = useState<ISODate>(startOfMonthISO());
  const [progress, setProgress] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const busy = progress !== null;

  const run = async () => {
    setOutcome(null);
    const read: Totals = { checked: 0, created: 0, skipped: 0, failed: 0, confirmed: 0 };
    try {
      // The server reads a batch per call (a Vercel function has a time limit); repeat while it makes progress.
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        setProgress(`Guruhdagi fayllar o'qilmoqda… ${fmtQty(read.checked)} ta o'qildi`);
        const r = await rescanNasiyaGroup(since);
        read.checked += r.checked;
        read.created += r.created;
        read.skipped += r.skipped;
        read.failed += r.failed;
        read.confirmed += r.confirmed;
        if (r.remaining === 0 || r.created + r.skipped === 0) break;
      }
      setProgress('Kunlar hisoblanmoqda…');
      const process = await processNasiyaReports(since);
      setOutcome({ read, process });
    } catch (err) {
      setOutcome({ error: errorMessage(err) });
    } finally {
      setProgress(null);
      await queryClient.invalidateQueries({ queryKey: nasiyaKeys.all });
    }
  };

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title="Hammasini hisoblash"
      subtitle="Guruhdagi Excel fayllar o'qiladi va har bir kun hisobga olinadi."
    >
      <ModalBody className="space-y-4">
        <Field label="Qaysi kundan" htmlFor="nasiya-since" hint="Shu kundan keyingi hamma kunlar hisoblanadi.">
          <Input
            id="nasiya-since"
            type="date"
            value={since}
            max={todayISO()}
            disabled={busy}
            onChange={(e) => setSince(e.target.value)}
          />
        </Field>
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-slate-600">
          <li>Bir kunga bir nechta fayl bo'lsa, eng oxirgisi olinadi.</li>
          <li>Varaq nomi mijoz nomiga aniq mos kelsa, o'zi bog'lanadi; mos kelmasa, kun kutib turadi.</li>
          <li>
            {isAdmin
              ? 'Xatosi bor fayllar ham hisoblanadi; xatolar hisobot sahifasida qoladi.'
              : 'Xatosi bor fayllarni faqat administrator hisoblay oladi.'}
          </li>
        </ul>
        {progress && <Alert tone="info">{progress}</Alert>}
        {outcome?.error !== undefined && <Alert tone="danger">{outcome.error}</Alert>}
        {outcome && outcome.error === undefined && <ResultView read={outcome.read} process={outcome.process} onClose={onClose} />}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Yopish
        </Button>
        <Button variant="primary" loading={busy} disabled={!since} onClick={() => void run()}>
          Hisoblash
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function ResultView({ read, process, onClose }: { read: Totals; process: NasiyaProcessResult; onClose: () => void }) {
  const confirmed = process.confirmed + read.confirmed;
  return (
    <div className="space-y-3">
      <Alert tone={process.waiting.length ? 'warning' : 'success'} title={`${fmtQty(confirmed)} kun hisoblandi`}>
        Guruhdan {fmtQty(read.checked)} ta fayl o'qildi, {fmtQty(read.created)} tasi yangi hisobot
        {read.failed > 0 && <>, {fmtQty(read.failed)} tasini yuklab bo'lmadi (keyinroq qayta urinib ko'ring)</>}.
        {process.superseded > 0 && <> Bir kunga ikkinchi fayl kelgan {fmtQty(process.superseded)} holatda oxirgisi olindi.</>}
      </Alert>
      {process.linked.length > 0 && (
        <div className="text-[13px]">
          <div className="mb-1 font-medium text-slate-700">Mijozga bog'landi:</div>
          <ul className="space-y-0.5 text-slate-600">
            {process.linked.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {process.waiting.length > 0 && (
        <div className="text-[13px]">
          <div className="mb-1 font-medium text-slate-700">Kutib turgan kunlar — ochib, qo'lda hal qiling:</div>
          <ul className="space-y-1">
            {process.waiting.map((w) => (
              <li key={w.report_id}>
                <Link to={`/nasiya/reports/${w.report_id}`} onClick={onClose} className="font-medium text-primary-700 hover:underline">
                  {fmtDate(w.report_date)}
                </Link>{' '}
                <span className="text-slate-600">— {w.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

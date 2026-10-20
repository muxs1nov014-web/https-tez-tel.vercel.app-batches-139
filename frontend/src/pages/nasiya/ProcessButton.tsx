import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import {
  getNasiyaBotStatus,
  nasiyaKeys,
  processNasiyaReports,
  rescanNasiyaGroup,
  type NasiyaProcessResult,
  type NasiyaRescanResult,
} from '../../api/nasiya';
import type { ISODate } from '../../api/types';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { RefreshIcon, TelegramIcon } from '../../components/ui/icons';
import { Field, Input } from '../../components/ui/Input';
import { Modal, ModalBody, ModalFooter } from '../../components/ui/Modal';
import { LoadingState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useCan } from '../../lib/auth';
import { startOfMonthISO, todayISO } from '../../lib/dates';
import { fmtDate, fmtDateTime, fmtQty } from '../../lib/format';

/** Safety stop for the read loop: 25 files a call, so 40 calls cover a thousand files. */
const MAX_ROUNDS = 40;

type Totals = Pick<NasiyaRescanResult, 'checked' | 'created' | 'skipped' | 'failed' | 'confirmed'>;
type Outcome = { read: Totals; process: NasiyaProcessResult; error?: undefined } | { error: string };

const BOT_STATUS_LABELS: Record<string, string> = {
  administrator: 'administrator',
  creator: 'egasi',
  member: "a'zo",
  left: 'guruhda emas',
  kicked: 'chiqarilgan',
  restricted: 'cheklangan',
  unknown: "noma'lum",
};

/** Reads the group's unhandled files (all of them, or those sent from `since`). The server reads a batch per call
 *  (a Vercel function has a time limit), so this repeats while a call makes progress. */
async function readGroup(since: ISODate | undefined, onProgress: (checked: number) => void): Promise<Totals> {
  const read: Totals = { checked: 0, created: 0, skipped: 0, failed: 0, confirmed: 0 };
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    onProgress(read.checked);
    const r = await rescanNasiyaGroup(since);
    read.checked += r.checked;
    read.created += r.created;
    read.skipped += r.skipped;
    read.failed += r.failed;
    read.confirmed += r.confirmed;
    if (r.remaining === 0 || r.created + r.skipped === 0) break;
  }
  return read;
}

/** "Telegramdan yangilash": read the group's new files now. A clean file of known customers is counted at once;
 *  when nothing arrives, the bot's state in the group says why. */
export function RefreshButton() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [showStatus, setShowStatus] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const read = await readGroup(undefined, () => undefined);
      if (read.checked === 0) setShowStatus(true);
      else {
        const waiting = read.created - read.confirmed;
        toast.success(
          `${fmtQty(read.created)} ta yangi fayl, ${fmtQty(read.confirmed)} kun hisoblandi` +
            (waiting > 0 ? `, ${fmtQty(waiting)} tasi tekshirishni kutmoqda` : '') +
            (read.failed ? `, ${fmtQty(read.failed)} tasini yuklab bo'lmadi` : ''),
        );
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: nasiyaKeys.all });
    }
  };

  return (
    <>
      <Button variant="subtle" loading={busy} icon={<TelegramIcon className="h-4 w-4" />} onClick={() => void run()}>
        Telegramdan yangilash
      </Button>
      {showStatus && (
        <Modal open onClose={() => setShowStatus(false)} title="Guruhda yangi fayl yo'q" subtitle="Bot holati Telegram'dan so'raldi.">
          <ModalBody>
            <BotStatusView />
          </ModalBody>
          <ModalFooter>
            <Button variant="primary" onClick={() => setShowStatus(false)}>
              Yopish
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </>
  );
}

/** What Telegram says about the bot and what was stored from each group: the reason files do or do not arrive. */
export function BotStatusView() {
  const query = useQuery({ queryKey: ['nasiya', 'bot-status'], queryFn: getNasiyaBotStatus, staleTime: 0 });
  if (query.isPending) return <LoadingState rows={3} />;
  if (query.isError) return <Alert tone="danger">{errorMessage(query.error)}</Alert>;
  const s = query.data;
  return (
    <div className="space-y-3 text-[13px]">
      {s.problems.length > 0 ? (
        <Alert tone="warning" title="Fayllar kelmasligi sababi">
          <ul className="list-disc space-y-1 pl-4">
            {s.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Alert>
      ) : (
        <Alert tone="success">Bot ishlayapti: guruhga yangi fayl tashlanganda u o'zi o'qiydi.</Alert>
      )}
      <div className="text-slate-600">
        Bot: <span className="font-medium">@{s.bot_username}</span> ·{' '}
        {s.can_read_all_group_messages ? "guruhdagi hamma xabarni ko'radi" : "privacy yoqilgan (admin bo'lsa hammasini ko'radi)"}
      </div>
      {s.groups.length > 0 && (
        <ul className="space-y-1">
          {s.groups.map((g) => (
            <li key={g.chat_id} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/5">
              <div className="font-medium text-slate-800">{g.title || g.chat_id}</div>
              <div className="text-slate-500">
                bot: {BOT_STATUS_LABELS[g.bot_status] ?? g.bot_status} · {fmtQty(g.messages)} xabar, {fmtQty(g.excel_files)} Excel
                {g.last_message_at && <> · oxirgisi {fmtDateTime(g.last_message_at)}</>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Alert tone="info" title="Eng oson yo'l">
        Guruhdagi faylni <span className="font-medium">@{s.bot_username}</span> ga forward qiling (yoki shu botga
        yuboring) — bot darhol hisoblaydi va natijani yozadi. Guruhga fayllarni boshqa bot tashlasa, Telegram ularni
        bu botga ko'rsatmaydi, shuning uchun forward kerak.
      </Alert>
      <p className="text-slate-500">
        Muhim: Telegram botga eski xabarlarni bermaydi. Bot ko'rmagan kunlarning fayllarini Telegram'dan saqlab,{' '}
        <span className="font-medium">Excel yuklash</span> bilan qo'shing (bir nechta faylni birdaniga tanlash mumkin).
      </p>
    </div>
  );
}

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
    try {
      const read = await readGroup(since, (n) => setProgress(`Guruhdagi fayllar o'qilmoqda… ${fmtQty(n)} ta o'qildi`));
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
          <li>Varaq nomi mijoz nomiga aniq mos kelsa, o'zi bog'lanadi; mos kelmasa, shu nomda yangi mijoz ochiladi.</li>
          <li>
            {isAdmin
              ? 'Xatosi bor fayllar ham hisoblanadi; xatolar hisobot sahifasida qoladi.'
              : 'Xatosi bor fayllarni faqat administrator hisoblay oladi.'}
          </li>
        </ul>
        {progress && <Alert tone="info">{progress}</Alert>}
        {outcome?.error !== undefined && <Alert tone="danger">{outcome.error}</Alert>}
        {outcome && outcome.error === undefined && <ResultView read={outcome.read} process={outcome.process} onClose={onClose} />}
        {outcome && outcome.error === undefined && outcome.read.checked === 0 && <BotStatusView />}
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

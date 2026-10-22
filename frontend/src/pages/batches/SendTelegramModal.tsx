import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { errorMessage } from '../../api/client';
import type { BatchDetail } from '../../api/batches';
import { listRecipients, notifyBatch, notifyBatchPhoto, notifyResultText, telegramKeys, type Recipient } from '../../api/telegram';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PaperAirplaneIcon } from '../../components/ui/icons';
import { Modal, ModalBody, ModalFooter } from '../../components/ui/Modal';
import { LoadingState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { drawCostPicture } from './costPicture';

/** The last choice, per browser: the same people usually get every batch. */
const STORAGE_KEY = 'teztel.batchNotify.chosen';

function loadChosen(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function saveChosen(ids: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // private mode or blocked storage: the choice is simply not remembered
  }
}

const KIND_LABEL: Record<Recipient['kind'], string> = { user: '', group: 'Guruh', channel: 'Kanal' };

interface SendTelegramModalProps {
  batch: BatchDetail;
  title: string;
  onClose: () => void;
}

/** Pick who gets this batch's per-model unit cost in Telegram (SPEC §17): a picture of the
 *  "Model bo'yicha tannarx" card, previewed here; the text message only if the browser cannot draw it. */
export function SendTelegramModal({ batch, title, onClose }: SendTelegramModalProps) {
  const toast = useToast();
  const [picture, setPicture] = useState<{ blob: Blob; url: string } | null>(null);
  const [pictureFailed, setPictureFailed] = useState(false);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    drawCostPicture(batch)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setPicture({ blob, url });
      })
      .catch(() => !cancelled && setPictureFailed(true));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [batch]);
  const query = useQuery({ queryKey: telegramKeys.recipients, queryFn: listRecipients });
  const recipients = useMemo(() => query.data ?? [], [query.data]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!query.data) return;
    const available = new Set(query.data.filter((r) => !r.blocked).map((r) => r.chat_id));
    setChosen(new Set(loadChosen().filter((id) => available.has(id))));
  }, [query.data]);

  const send = useMutation({
    mutationFn: (ids: string[]) => (picture ? notifyBatchPhoto(batch.id, ids, picture.blob) : notifyBatch(batch.id, ids)),
    onSuccess: (r, ids) => {
      saveChosen(ids);
      if (r.failed > 0 || r.recipients === 0) toast.error(notifyResultText(r));
      else toast.success(notifyResultText(r));
      onClose();
    },
  });

  // A chat that blocked the bot cannot be picked: it got its one attempt.
  const pickable = recipients.filter((r) => !r.blocked);
  const allChosen = pickable.length > 0 && pickable.every((r) => chosen.has(r.chat_id));
  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setChosen(allChosen ? new Set() : new Set(pickable.map((r) => r.chat_id)));
  // Keep the list order, so the messages go out in the order shown.
  const chosenIds = pickable.filter((r) => chosen.has(r.chat_id)).map((r) => r.chat_id);

  return (
    <Modal open title="Telegramga yuborish" subtitle={title} onClose={onClose} size="sm">
      <ModalBody className="space-y-3">
        {query.isPending ? (
          <LoadingState rows={4} />
        ) : query.isError ? (
          <Alert tone="danger">{errorMessage(query.error)}</Alert>
        ) : recipients.length === 0 ? (
          <Alert tone="warning">
            Qabul qiluvchi yo'q. Administrator «Bot foydalanuvchilari» sahifasida odam qo'shishi kerak.
          </Alert>
        ) : (
          <>
            <p className="text-[13px] text-slate-500">
              Kimlarga borsin? Model bo'yicha 1 dona tannarx {pictureFailed ? "matn bo'lib" : "shu rasm bo'lib"} yuboriladi.
            </p>
            {picture && (
              <img
                src={picture.url}
                alt="Model bo'yicha tannarx"
                className="max-h-[40vh] w-full rounded-[12px] object-contain object-top ring-1 ring-slate-200/80 dark:ring-white/[0.08]"
              />
            )}
            <div className="overflow-hidden rounded-[14px] ring-1 ring-slate-200/80 dark:ring-white/[0.08]">
              <label className="flex min-h-[48px] cursor-pointer items-center gap-3 border-b border-slate-200/70 bg-slate-50 px-4 dark:border-white/[0.08] dark:bg-white/[0.03]">
                <input
                  type="checkbox"
                  checked={allChosen}
                  disabled={pickable.length === 0}
                  onChange={toggleAll}
                  className="h-5 w-5 shrink-0 rounded accent-primary-600"
                />
                <span className="flex-1 text-[15px] font-medium text-slate-900">Hammasi</span>
                <span className="text-[13px] tabular-nums text-slate-500">
                  {chosen.size} / {pickable.length}
                </span>
              </label>
              <ul className="max-h-[50vh] divide-y divide-slate-200/70 overflow-y-auto dark:divide-white/[0.08]">
                {recipients.map((r) => (
                  <li key={r.chat_id}>
                    <label
                      className={`flex min-h-[48px] items-center gap-3 px-4 py-2 ${r.blocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                    >
                      <input
                        type="checkbox"
                        checked={!r.blocked && chosen.has(r.chat_id)}
                        disabled={r.blocked}
                        onChange={() => toggle(r.chat_id)}
                        className="h-5 w-5 shrink-0 rounded accent-primary-600"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] text-slate-900">{r.name}</span>
                        {r.blocked ? (
                          <span className="block text-[12px] text-danger-600">
                            Botni bloklagan yoki o'chirgan — botga qayta yozmaguncha yuborilmaydi
                          </span>
                        ) : (
                          r.kind !== 'user' && <span className="block text-[12px] text-slate-500">{KIND_LABEL[r.kind]}</span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
        {send.isError && <Alert tone="danger">{errorMessage(send.error)}</Alert>}
      </ModalBody>
      <ModalFooter>
        <Button onClick={onClose} disabled={send.isPending}>
          Bekor qilish
        </Button>
        <Button
          variant="primary"
          icon={<PaperAirplaneIcon className="h-4 w-4" />}
          loading={send.isPending}
          disabled={chosenIds.length === 0 || (!picture && !pictureFailed)}
          onClick={() => send.mutate(chosenIds)}
        >
          Yuborish{chosenIds.length > 0 ? ` (${chosenIds.length})` : ''}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

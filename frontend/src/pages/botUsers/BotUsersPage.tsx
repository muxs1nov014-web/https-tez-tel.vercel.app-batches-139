import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  botUserKeys,
  createBotUser,
  deleteBotUser,
  listBotUsers,
  updateBotUser,
  type BotUser,
  type BotUserPatch,
} from '../../api/botUsers';
import { errorMessage } from '../../api/client';
import { getNotifyConfig, putNotifyConfig, telegramKeys, type NotifyConfig } from '../../api/telegram';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, TableWrap } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { PencilIcon, PlusIcon, TrashIcon } from '../../components/ui/icons';
import { Field, Input } from '../../components/ui/Input';
import { ListRow, ListSection } from '../../components/ui/List';
import { Modal, ModalBody, ModalFooter } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, LoadingState, QueryView } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { fmtDateTime } from '../../lib/format';
import { TINTS } from '../../lib/tints';

const EMPTY = (
  <EmptyState
    title="Hali hech kimga ruxsat berilmagan"
    description="Foydalanuvchi botga yozsa, bot unga Telegram ID sini ko'rsatadi — o'sha ID ni yuqorida qo'shing."
  />
);

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

/** Telegram-blue monogram, like a chat avatar. */
function Monogram({ name }: { name: string }) {
  return (
    <span
      className={`my-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-b text-[15px] font-semibold text-white ${TINTS.telegram}`}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function BotUsersPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: botUserKeys.all, queryFn: listBotUsers });
  const [editing, setEditing] = useState<BotUser | null>(null);
  const [toDelete, setToDelete] = useState<BotUser | null>(null);
  const [acting, setActing] = useState<BotUser | null>(null);

  const toggle = useMutation({
    mutationFn: ({ id, body }: { id: number; body: BotUserPatch }) => updateBotUser(id, body),
    onSuccess: (u) => {
      void queryClient.invalidateQueries({ queryKey: botUserKeys.all });
      toast.success(u.is_active ? `${u.full_name}: ruxsat berildi` : `${u.full_name}: ruxsat to'xtatildi`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const del = useMutation({
    mutationFn: (id: number) => deleteBotUser(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: botUserKeys.all });
      toast.success("Bot foydalanuvchisi o'chirildi");
      setToDelete(null);
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bot foydalanuvchilari"
        subtitle="Telegram botdan foydalanishga ruxsat berilganlar. Ro'yxatdagi har bir faol foydalanuvchi tannarx va foydani ko'ra oladi."
      />
      <AddBotUserForm />
      <NotifySettingsCard />

      {/* iPhone: list rows; a tap opens an action sheet with the row actions. */}
      <div className="pt-4 md:hidden">
        <QueryView query={query} isEmpty={(rows) => rows.length === 0} loading={<LoadingState />} empty={EMPTY}>
          {(rows) => (
            <ListSection header="Ruxsat berilganlar">
              {rows.map((u) => (
                <ListRow
                  key={u.id}
                  onClick={() => setActing(u)}
                  chevron
                  leading={<Monogram name={u.full_name} />}
                  title={u.full_name}
                  subtitle={`ID ${u.telegram_id} · ${fmtDateTime(u.created_at)}`}
                  value={
                    u.is_active ? (
                      <span className="text-[15px]">Faol</span>
                    ) : (
                      <span className="text-[15px] text-warning-600">To'xtatilgan</span>
                    )
                  }
                />
              ))}
            </ListSection>
          )}
        </QueryView>
      </div>

      <Card title="Ruxsat berilganlar" className="hidden md:block">
        <QueryView query={query} isEmpty={(rows) => rows.length === 0} empty={EMPTY}>
          {(rows) => (
            <TableWrap>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Telegram ID</th>
                    <th>F.I.Sh.</th>
                    <th>Holati</th>
                    <th>Qo'shilgan</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => (
                    <tr key={u.id}>
                      <td className="font-mono text-xs">{u.telegram_id}</td>
                      <td className="font-medium">{u.full_name}</td>
                      <td>{u.is_active ? <Badge tone="success">Faol</Badge> : <Badge>To'xtatilgan</Badge>}</td>
                      <td className="text-xs text-slate-500">{fmtDateTime(u.created_at)}</td>
                      <td className="whitespace-nowrap text-right">
                        <Button
                          size="xs"
                          variant="ghost"
                          loading={toggle.isPending && toggle.variables?.id === u.id}
                          onClick={() => toggle.mutate({ id: u.id, body: { is_active: !u.is_active } })}
                        >
                          {u.is_active ? "To'xtatish" : 'Faollashtirish'}
                        </Button>
                        <IconButton label="Tahrirlash" onClick={() => setEditing(u)}>
                          <PencilIcon className="h-4 w-4" />
                        </IconButton>
                        <IconButton label="O'chirish" tone="danger" onClick={() => setToDelete(u)}>
                          <TrashIcon className="h-4 w-4" />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </QueryView>
      </Card>

      {editing && <EditBotUserModal user={editing} onClose={() => setEditing(null)} />}

      <Modal
        open={acting !== null}
        title={acting?.full_name ?? ''}
        subtitle={acting ? `Telegram ID: ${acting.telegram_id}` : undefined}
        onClose={() => setActing(null)}
        size="sm"
      >
        {acting && (
          <ModalBody className="space-y-4 bg-canvas pb-[max(1.25rem,env(safe-area-inset-bottom))] dark:bg-transparent">
            <ListSection>
              <ListRow
                title="Tahrirlash"
                tone="primary"
                center
                onClick={() => {
                  setEditing(acting);
                  setActing(null);
                }}
              />
              <ListRow
                title={acting.is_active ? "To'xtatish" : 'Faollashtirish'}
                tone="primary"
                center
                onClick={() => {
                  toggle.mutate({ id: acting.id, body: { is_active: !acting.is_active } });
                  setActing(null);
                }}
              />
            </ListSection>
            <ListSection>
              <ListRow
                title="O'chirish"
                tone="danger"
                center
                onClick={() => {
                  setToDelete(acting);
                  setActing(null);
                }}
              />
            </ListSection>
          </ModalBody>
        )}
      </Modal>

      <ConfirmDialog
        open={toDelete !== null}
        title="Bot foydalanuvchisini o'chirish"
        message={toDelete && `${toDelete.full_name} (${toDelete.telegram_id}) ro'yxatdan o'chirilsinmi? Bot unga javob bermay qo'yadi.`}
        loading={del.isPending}
        error={del.isError ? errorMessage(del.error) : null}
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
        onClose={() => {
          setToDelete(null);
          del.reset();
        }}
      />
    </div>
  );
}

function AddBotUserForm() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [telegramId, setTelegramId] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: createBotUser,
    onSuccess: (u) => {
      void queryClient.invalidateQueries({ queryKey: botUserKeys.all });
      toast.success(`${u.full_name} qo'shildi`);
      setTelegramId('');
      setFullName('');
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const id = Number(telegramId.trim());
    if (!/^-?\d{3,20}$/.test(telegramId.trim()) || !Number.isSafeInteger(id)) {
      setError("Telegram ID — faqat raqamlar (masalan 123456789)");
      return;
    }
    if (!fullName.trim()) {
      setError('F.I.Sh. ni kiriting');
      return;
    }
    setError(null);
    mutation.mutate({ telegram_id: id, full_name: fullName.trim() });
  };

  const errorText = error ?? (mutation.isError ? errorMessage(mutation.error) : null);

  return (
    <>
    {/* iPhone: inline-label form rows and a full-width capsule, like iOS Settings forms. */}
    <form onSubmit={onSubmit} noValidate className="space-y-3 md:hidden">
      <ListSection header="Ruxsat berish">
        <li>
          <label htmlFor="bu-tg-m" className="relative flex min-h-[48px] items-center gap-3 px-4">
            <span className="w-28 shrink-0 text-[17px] tracking-[-0.025em] text-slate-900">Telegram ID</span>
            <input
              id="bu-tg-m"
              inputMode="numeric"
              autoComplete="off"
              value={telegramId}
              onChange={(e) => setTelegramId(e.target.value)}
              placeholder="123456789"
              className="min-w-0 flex-1 bg-transparent py-3 text-[17px] tabular-nums tracking-[-0.025em] text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
            <span className="list-sep pointer-events-none absolute bottom-0 left-4 right-0 h-[0.5px] bg-slate-200" />
          </label>
        </li>
        <li>
          <label htmlFor="bu-name-m" className="relative flex min-h-[48px] items-center gap-3 px-4">
            <span className="w-28 shrink-0 text-[17px] tracking-[-0.025em] text-slate-900">F.I.Sh.</span>
            <input
              id="bu-name-m"
              autoComplete="off"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="min-w-0 flex-1 bg-transparent py-3 text-[17px] tracking-[-0.025em] text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
            <span className="list-sep pointer-events-none absolute bottom-0 left-4 right-0 h-[0.5px] bg-slate-200" />
          </label>
        </li>
      </ListSection>
      {errorText && <Alert tone="danger">{errorText}</Alert>}
      <Button
        type="submit"
        variant="primary"
        loading={mutation.isPending}
        icon={<PlusIcon className="h-4 w-4" />}
        className="w-full max-md:h-12 max-md:text-[17px]"
      >
        Qo'shish
      </Button>
    </form>

    <Card title="Ruxsat berish" padded className="hidden md:block">
      <form onSubmit={onSubmit} noValidate className="flex flex-wrap items-end gap-3">
        <Field label="Telegram ID" htmlFor="bu-tg">
          <Input
            id="bu-tg"
            inputMode="numeric"
            value={telegramId}
            onChange={(e) => setTelegramId(e.target.value)}
            className="w-44 font-mono"
            placeholder="123456789"
          />
        </Field>
        <Field label="F.I.Sh." htmlFor="bu-name" className="min-w-[16rem] flex-1">
          <Input id="bu-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" loading={mutation.isPending} icon={<PlusIcon className="h-4 w-4" />}>
          Qo'shish
        </Button>
      </form>
      {errorText && (
        <Alert tone="danger" className="mt-3">
          {errorText}
        </Alert>
      )}
    </Card>
    </>
  );
}

function EditBotUserModal({ user, onClose }: { user: BotUser; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [fullName, setFullName] = useState(user.full_name);
  const mutation = useMutation({
    mutationFn: (body: BotUserPatch) => updateBotUser(user.id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: botUserKeys.all });
      toast.success('Saqlandi');
      onClose();
    },
  });

  return (
    <Modal open title="Bot foydalanuvchisi" subtitle={`Telegram ID: ${user.telegram_id}`} onClose={onClose} size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (fullName.trim()) mutation.mutate({ full_name: fullName.trim() });
        }}
      >
        <ModalBody className="space-y-3">
          <Field label="F.I.Sh." htmlFor="bu-edit-name" required>
            <Input id="bu-edit-name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
          </Field>
          {mutation.isError && <Alert tone="danger">{errorMessage(mutation.error)}</Alert>}
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose} disabled={mutation.isPending}>
            Bekor qilish
          </Button>
          <Button type="submit" variant="primary" loading={mutation.isPending} disabled={!fullName.trim()}>
            Saqlash
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/** Groups/channels the batch page picker offers besides the bot users (SPEC §17). */
function NotifySettingsCard() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: telegramKeys.notify, queryFn: getNotifyConfig });
  const [chats, setChats] = useState('');

  useEffect(() => {
    if (query.data) setChats(query.data.chat_ids.join(', '));
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: () => putNotifyConfig({ chat_ids: chats.split(/[\s,;]+/).filter(Boolean) }),
    onSuccess: (data: NotifyConfig) => {
      queryClient.setQueryData(telegramKeys.notify, data);
      toast.success('Saqlandi');
    },
  });

  const addChat = (id: number) => {
    const list = chats.split(/[\s,;]+/).filter(Boolean);
    if (!list.includes(String(id))) setChats([...list, String(id)].join(', '));
  };

  return (
    <Card
      title="Partiya tannarxi — Telegram"
      subtitle="Model bo'yicha 1 dona tannarx faqat partiya sahifasidagi «Telegramga yuborish» tugmasi orqali, u yerda belgilangan odamlarga boradi. Ro'yxatda yuqoridagi faol bot foydalanuvchilari bor; bu yerda unga guruh yoki kanal qo'shish mumkin."
      padded
    >
      {query.isPending ? (
        <LoadingState rows={2} />
      ) : query.isError ? (
        <Alert tone="danger">{errorMessage(query.error)}</Alert>
      ) : (
        <form
          noValidate
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          {!query.data.bot_configured && (
            <Alert tone="warning">Bot tokeni (TELEGRAM_BOT_TOKEN) sozlanmagan — xabar yuborilmaydi.</Alert>
          )}
          <Field
            label="Guruh va kanallar (chat ID)"
            htmlFor="notify-chats"
            hint="Guruh ID si minus bilan boshlanadi (-100…), kanal uchun @nomi. Bot o'sha guruhga qo'shilgan (kanalda admin) bo'lishi kerak."
          >
            <Input
              id="notify-chats"
              value={chats}
              onChange={(e) => setChats(e.target.value)}
              placeholder="-1001234567890, @kanal"
              className="font-mono"
              autoComplete="off"
            />
          </Field>
          {query.data.groups.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[12.5px] font-medium text-slate-600">Bot turgan guruhlar</div>
              <div className="flex flex-wrap gap-2">
                {query.data.groups.map((g) => (
                  <Button key={g.chat_id} size="xs" variant="subtle" onClick={() => addChat(g.chat_id)}>
                    + {g.title || 'Guruh'} <span className="font-mono opacity-70">{g.chat_id}</span>
                  </Button>
                ))}
              </div>
            </div>
          )}
          {mutation.isError && <Alert tone="danger">{errorMessage(mutation.error)}</Alert>}
          <Button type="submit" variant="primary" loading={mutation.isPending} className="max-md:h-12 max-md:w-full max-md:text-[17px]">
            Saqlash
          </Button>
        </form>
      )}
    </Card>
  );
}

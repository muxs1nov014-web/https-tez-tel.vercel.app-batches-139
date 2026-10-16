import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../api/client';
import type { Role } from '../../api/types';
import { createUser, listUsers, updateUser, userKeys, type User, type UserPatch } from '../../api/users';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, TableWrap } from '../../components/ui/Card';
import { PencilIcon, PlusIcon } from '../../components/ui/icons';
import { Checkbox, Field, Input, Select } from '../../components/ui/Input';
import { ListRow, ListSection } from '../../components/ui/List';
import { Modal, ModalBody, ModalFooter } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, LoadingState, QueryView } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../lib/auth';
import { ROLE_LABELS } from '../../lib/categories';

const ROLES: Role[] = ['admin', 'operator', 'viewer'];

const ROLE_HINTS: Record<Role, string> = {
  admin: "Hammasi: foydalanuvchilar, sozlamalar, o'chirish",
  operator: 'Xarid, xarajat, sotuv, katalog, import',
  viewer: "Faqat ko'rish",
};

function parseRole(value: string): Role {
  return ROLES.find((r) => r === value) ?? 'viewer';
}

const MIN_PASSWORD = 6;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

/** Contacts-style monogram. */
function Avatar({ name }: { name: string }) {
  return (
    <span
      className="my-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#a9a9ae] to-[#7c7c82] text-[15px] font-semibold text-white"
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function UsersPage() {
  const query = useQuery({ queryKey: userKeys.all, queryFn: listUsers });
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const { user: me } = useAuth();

  return (
    <div>
      <PageHeader
        title="Foydalanuvchilar"
        subtitle="Boshqaruv paneliga kirish huquqi. Rollar: administrator, operator, kuzatuvchi."
        actions={
          <Button variant="primary" icon={<PlusIcon className="h-4 w-4" />} onClick={() => setEditing('new')}>
            Foydalanuvchi qo'shish
          </Button>
        }
      />
      {/* iPhone: Contacts-style list; tapping a person opens the editor. */}
      <div className="md:hidden">
        <QueryView
          query={query}
          isEmpty={(rows) => rows.length === 0}
          loading={<LoadingState />}
          empty={<EmptyState title="Foydalanuvchi yo'q" />}
        >
          {(rows) => (
            <ListSection>
              {rows.map((u) => (
                <ListRow
                  key={u.id}
                  onClick={() => setEditing(u)}
                  chevron
                  leading={<Avatar name={u.full_name || u.username} />}
                  title={
                    <>
                      {u.full_name || u.username}
                      {me?.id === u.id && <span className="ml-1.5 text-[15px] text-slate-400">(siz)</span>}
                    </>
                  }
                  subtitle={`@${u.username} · ${ROLE_LABELS[u.role]}${u.telegram_id ? ` · Telegram ${u.telegram_id}` : ''}`}
                  value={
                    u.is_active ? (
                      <span className="text-[15px]">Faol</span>
                    ) : (
                      <span className="text-[15px] text-danger-600">Bloklangan</span>
                    )
                  }
                />
              ))}
            </ListSection>
          )}
        </QueryView>
      </div>

      <Card className="hidden md:block">
        <QueryView query={query} isEmpty={(rows) => rows.length === 0} empty={<EmptyState title="Foydalanuvchi yo'q" />}>
          {(rows) => (
            <TableWrap>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Login</th>
                    <th>F.I.Sh.</th>
                    <th>Rol</th>
                    <th>Telegram</th>
                    <th>Holati</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => (
                    <tr key={u.id}>
                      <td className="font-mono text-xs">
                        {u.username}
                        {me?.id === u.id && <span className="ml-1.5 font-sans text-[11px] text-slate-400">(siz)</span>}
                      </td>
                      <td className="font-medium">{u.full_name}</td>
                      <td>
                        <Badge tone={u.role === 'admin' ? 'primary' : u.role === 'operator' ? 'success' : 'slate'}>
                          {ROLE_LABELS[u.role]}
                        </Badge>
                      </td>
                      <td className="tabular-nums text-slate-500">
                        {u.telegram_id ? <Badge tone="primary">{u.telegram_id}</Badge> : '—'}
                      </td>
                      <td>{u.is_active ? <Badge tone="success">Faol</Badge> : <Badge>Bloklangan</Badge>}</td>
                      <td className="w-8 text-right">
                        <IconButton label="Tahrirlash" onClick={() => setEditing(u)}>
                          <PencilIcon className="h-4 w-4" />
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
      {editing && (
        <UserModal
          user={editing === 'new' ? null : editing}
          isSelf={editing !== 'new' && me?.id === editing.id}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface UserModalProps {
  user: User | null;
  isSelf: boolean;
  onClose: () => void;
}

function UserModal({ user, isSelf, onClose }: UserModalProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [username, setUsername] = useState(user?.username ?? '');
  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'operator');
  const [isActive, setIsActive] = useState(user?.is_active ?? true);
  const [password, setPassword] = useState('');
  const [telegramId, setTelegramId] = useState(user?.telegram_id ? String(user.telegram_id) : '');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: UserPatch & { username?: string }) =>
      user
        ? updateUser(user.id, body)
        : createUser({
            username: body.username ?? '',
            password: body.password ?? '',
            full_name: body.full_name ?? '',
            role: body.role ?? 'viewer',
            telegram_id: body.telegram_id ?? null,
          }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
      toast.success(`${saved.username} saqlandi`);
      onClose();
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!user && !/^[a-zA-Z0-9_.-]{3,}$/.test(username.trim())) {
      setError("Login: kamida 3 ta lotin harfi, raqam yoki _ . -");
      return;
    }
    if (!fullName.trim()) {
      setError('F.I.Sh. ni kiriting');
      return;
    }
    if ((!user || password) && password.length < MIN_PASSWORD) {
      setError(`Parol kamida ${MIN_PASSWORD} ta belgi bo'lsin`);
      return;
    }
    const tgText = telegramId.trim();
    if (tgText && !/^[1-9]\d{4,14}$/.test(tgText)) {
      setError("Telegram ID faqat raqamlardan iborat bo'lsin (botga /start yuborsa, bot ID ni ko'rsatadi)");
      return;
    }
    const tgValue = tgText ? Number(tgText) : null;
    setError(null);
    if (user) {
      const body: UserPatch = { full_name: fullName.trim(), telegram_id: tgValue };
      if (!isSelf) {
        body.role = role;
        body.is_active = isActive;
      }
      if (password) body.password = password;
      mutation.mutate(body);
    } else {
      mutation.mutate({ username: username.trim(), full_name: fullName.trim(), role, password, telegram_id: tgValue });
    }
  };

  return (
    <Modal open title={user ? 'Foydalanuvchini tahrirlash' : "Foydalanuvchi qo'shish"} subtitle={user?.username} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate>
        <ModalBody className="space-y-3">
          {!user && (
            <Field label="Login" htmlFor="u-username" required>
              <Input
                id="u-username"
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
              />
            </Field>
          )}
          <Field label="F.I.Sh." htmlFor="u-fullname" required>
            <Input id="u-fullname" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field
            label="Rol"
            htmlFor="u-role"
            hint={isSelf ? "O'z rolingizni o'zgartira olmaysiz" : ROLE_HINTS[role]}
          >
            <Select id="u-role" value={role} disabled={isSelf} onChange={(e) => setRole(parseRole(e.target.value))}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={user ? 'Yangi parol' : 'Parol'}
            htmlFor="u-password"
            required={!user}
            hint={user ? "O'zgartirmaslik uchun bo'sh qoldiring" : `Kamida ${MIN_PASSWORD} ta belgi`}
          >
            <Input
              id="u-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field
            label="Telegram ID"
            htmlFor="u-telegram"
            hint="Telegram Mini App orqali parolsiz kirish uchun. Bo'sh qoldirilsa, ulanmaydi."
          >
            <Input
              id="u-telegram"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Masalan: 123456789"
              value={telegramId}
              onChange={(e) => setTelegramId(e.target.value)}
            />
          </Field>
          {user && !isSelf && <Checkbox checked={isActive} onChange={setIsActive} label="Faol (tizimga kira oladi)" />}
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

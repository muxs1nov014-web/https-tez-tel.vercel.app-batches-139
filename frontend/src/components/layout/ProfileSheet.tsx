import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { authKeys, updateMe, type MePatch } from '../../api/auth';
import { errorMessage } from '../../api/client';
import { useAuth } from '../../lib/auth';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Input';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { useToast } from '../ui/Toast';

const MIN_PASSWORD = 12;

/** Own login and password (Apple ID "Sign-In & Security" style sheet). */
export function ProfileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [current, setCurrent] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUsername(user?.username ?? '');
    setPassword('');
    setRepeat('');
    setCurrent('');
    setSubmitted(false);
  }, [open, user?.username]);

  const mutation = useMutation({
    mutationFn: (body: MePatch) => updateMe(body),
    onSuccess: (updated) => {
      queryClient.setQueryData(authKeys.me, updated);
      toast.success("Login va parol saqlandi");
      onClose();
    },
  });

  const login = username.trim();
  const loginChanged = Boolean(user) && login !== user?.username;
  const errors = {
    username: login.length < 3 ? "Login kamida 3 belgi" : null,
    password: password && password.length < MIN_PASSWORD ? `Parol kamida ${MIN_PASSWORD} belgi` : null,
    repeat: password && repeat !== password ? 'Parollar bir xil emas' : null,
    current: current ? null : 'Joriy parolni kiriting',
    nothing: !loginChanged && !password ? "Login yoki parolni o'zgartiring" : null,
  };
  const invalid = Object.values(errors).some(Boolean);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (invalid) return;
    mutation.mutate({
      current_password: current,
      ...(loginChanged ? { username: login } : {}),
      ...(password ? { password } : {}),
    });
  };

  const show = (error: string | null) => (submitted ? error : null);

  return (
    <Modal open={open} title="Kirish va xavfsizlik" subtitle="Login va parolni o'zgartirish" onClose={onClose} size="sm">
      <form onSubmit={submit} noValidate>
        <ModalBody className="space-y-4">
          <Field label="Login" htmlFor="me-username" error={show(errors.username)}>
            <Input
              id="me-username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              invalid={Boolean(show(errors.username))}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
          <Field
            label="Yangi parol"
            htmlFor="me-password"
            hint={`Bo'sh qoldirsangiz, parol o'zgarmaydi. Kamida ${MIN_PASSWORD} belgi.`}
            error={show(errors.password)}
          >
            <Input
              id="me-password"
              type="password"
              autoComplete="new-password"
              value={password}
              invalid={Boolean(show(errors.password))}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {password && (
            <Field label="Yangi parolni takrorlang" htmlFor="me-repeat" error={show(errors.repeat)}>
              <Input
                id="me-repeat"
                type="password"
                autoComplete="new-password"
                value={repeat}
                invalid={Boolean(show(errors.repeat))}
                onChange={(e) => setRepeat(e.target.value)}
              />
            </Field>
          )}
          <Field label="Joriy parol" htmlFor="me-current" required error={show(errors.current)}>
            <Input
              id="me-current"
              type="password"
              autoComplete="current-password"
              value={current}
              invalid={Boolean(show(errors.current))}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          {submitted && errors.nothing && <Alert tone="warning">{errors.nothing}</Alert>}
          {mutation.isError && <Alert tone="danger">{errorMessage(mutation.error)}</Alert>}
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

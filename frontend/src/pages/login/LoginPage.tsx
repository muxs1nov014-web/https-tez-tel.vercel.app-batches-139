import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError, errorMessage } from '../../api/client';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PhoneIcon } from '../../components/ui/icons';
import { useAuth } from '../../lib/auth';

interface LocationState {
  from?: string;
}

function isLocationState(value: unknown): value is LocationState {
  return typeof value === 'object' && value !== null;
}

export function LoginPage() {
  const { status, login, telegramError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = isLocationState(location.state) && location.state.from ? location.state.from : '/';

  if (status === 'authenticated') return <Navigate to={from} replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Login va parolni kiriting');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await login(username.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && (err.status === 401 || err.status === 400)
          ? "Login yoki parol noto'g'ri"
          : errorMessage(err),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-4 py-10">
      {/* Soft ambient light behind the card, as on Apple Account sign-in. */}
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_560px_at_50%_-10%,rgb(var(--c-primary-500)/0.14),transparent_70%)]"
        aria-hidden="true"
      />
      <div className="relative w-full max-w-[400px] animate-sheet-in rounded-[28px] bg-surface px-6 pb-8 pt-10 shadow-pop dark:shadow-none dark:ring-1 dark:ring-white/[0.08] sm:px-9 sm:pb-10 sm:pt-12">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="flex h-[88px] w-[88px] items-center justify-center rounded-[20px] bg-gradient-to-b from-[#4ea6ff] to-[#0066d6] text-white shadow-[0_10px_30px_rgb(var(--c-primary-600)/0.35)]">
            <PhoneIcon className="h-[48px] w-[48px] [&>path]:stroke-[1.5]" />
          </span>
          <h1 className="mt-6 text-[28px] font-bold leading-tight tracking-[-0.03em] text-slate-900">TezTel</h1>
          <p className="mt-1.5 text-[15px] leading-snug text-slate-500">Import nazorati paneliga kiring</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {telegramError && !error && (
            <Alert tone="info" title="Telegram orqali avtomatik kirilmadi">
              {telegramError}
            </Alert>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
          {/* One grouped field box with a hairline between the rows, labels inside (Apple Account). */}
          <div className="overflow-hidden rounded-[14px] ring-1 ring-slate-300/80 transition-shadow focus-within:ring-2 focus-within:ring-primary-500 dark:ring-slate-300">
            <label htmlFor="username" className="block px-4 pb-2.5 pt-3">
              <span className="block text-[12px] font-medium text-slate-500">Login</span>
              <input
                id="username"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-0.5 block w-full bg-transparent text-[17px] tracking-[-0.02em] text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
            </label>
            <div className="border-t border-slate-300/80 dark:border-slate-300" />
            <label htmlFor="password" className="block px-4 pb-2.5 pt-3">
              <span className="block text-[12px] font-medium text-slate-500">Parol</span>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-0.5 block w-full bg-transparent text-[17px] tracking-[-0.02em] text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
            </label>
          </div>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="!mt-6 w-full !h-12 !text-[17px] !font-semibold"
            loading={submitting}
          >
            Kirish
          </Button>
        </form>
      </div>
    </div>
  );
}

import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import type { Action } from '../lib/permissions';
import { Button } from './ui/Button';
import { ErrorState, ForbiddenState, LoadingState } from './ui/States';

/** Sends anonymous users to /login, remembering where they were going. */
export function RequireAuth() {
  const { status, error, retry, logout } = useAuth();
  const location = useLocation();

  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingState label="Sessiya tekshirilmoqda…" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center">
        <ErrorState error={error} onRetry={retry} title="Serverga ulanib bo'lmadi" />
        <Button variant="ghost" size="sm" onClick={logout}>
          Chiqish
        </Button>
      </div>
    );
  }
  return <Outlet />;
}

/** Page-level guard: renders a "no access" state instead of the page. */
export function RequireCan({ action, children }: { action: Action; children: ReactNode }) {
  const { can } = useAuth();
  return <>{can(action) ? children : <ForbiddenState />}</>;
}

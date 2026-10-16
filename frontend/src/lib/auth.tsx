import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authKeys, getMe, login as loginRequest, loginTelegram, type User } from '../api/auth';
import { errorMessage, setUnauthorizedHandler, tokenStorage } from '../api/client';
import { canRole, type Action } from './permissions';
import { telegramInitData } from './telegram';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error';

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  error: Error | null;
  /** Why automatic Telegram sign-in failed (shown on the login form), if it did. */
  telegramError: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  retry: () => void;
  can: (action: Action) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(() => tokenStorage.get());
  // Inside the Telegram Mini App with no session yet: try signing in with Telegram first.
  const [telegramPending, setTelegramPending] = useState(() => token === null && telegramInitData() !== null);
  const [telegramError, setTelegramError] = useState<string | null>(null);

  useEffect(() => {
    // Any 401 from the API: drop the session; route guards send the user to /login.
    setUnauthorizedHandler(() => {
      setToken(null);
      queryClient.clear();
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  const meQuery = useQuery({
    queryKey: authKeys.me,
    queryFn: getMe,
    enabled: token !== null,
    retry: false,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!telegramPending) return undefined;
    const initData = telegramInitData();
    if (!initData) {
      setTelegramPending(false);
      return undefined;
    }
    let cancelled = false;
    loginTelegram(initData)
      .then((result) => {
        if (cancelled) return;
        tokenStorage.set(result.access_token);
        queryClient.clear();
        queryClient.setQueryData(authKeys.me, result.user);
        setToken(result.access_token);
      })
      .catch((err: unknown) => {
        if (!cancelled) setTelegramError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setTelegramPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [telegramPending, queryClient]);

  const login = useCallback(
    async (username: string, password: string) => {
      const result = await loginRequest({ username, password });
      tokenStorage.set(result.access_token);
      queryClient.clear();
      queryClient.setQueryData(authKeys.me, result.user);
      setToken(result.access_token);
    },
    [queryClient],
  );

  const logout = useCallback(() => {
    tokenStorage.clear();
    setToken(null);
    queryClient.clear();
  }, [queryClient]);

  const { refetch } = meQuery;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const user = token !== null ? (meQuery.data ?? null) : null;

  let status: AuthStatus;
  if (token === null) status = telegramPending ? 'loading' : 'anonymous';
  else if (user) status = 'authenticated';
  else if (meQuery.isError) status = 'error';
  else status = 'loading';

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      error: meQuery.error,
      telegramError,
      login,
      logout,
      retry,
      can: (action: Action) => canRole(user?.role, action),
    }),
    [status, user, meQuery.error, telegramError, login, logout, retry],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function useCan(): (action: Action) => boolean {
  return useAuth().can;
}

import type { ReactNode } from 'react';
import { useCan } from '../lib/auth';
import type { Action } from '../lib/permissions';

interface CanProps {
  do: Action;
  children: ReactNode;
  fallback?: ReactNode;
}

/** Renders children only when the current user may perform `do`. */
export function Can({ do: action, children, fallback = null }: CanProps) {
  const can = useCan();
  return <>{can(action) ? children : fallback}</>;
}

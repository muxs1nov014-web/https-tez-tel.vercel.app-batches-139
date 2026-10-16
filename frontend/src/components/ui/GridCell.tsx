import type { ReactNode } from 'react';

/**
 * One cell of a line-entry grid. Below `lg` the grid stacks and its column-header row is hidden,
 * so each cell shows its own caption; from `lg` up the caption disappears and the header row takes over.
 */
export function GridCell({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <span className="mb-1 block text-[11.5px] font-medium text-slate-500 lg:hidden">{label}</span>
      {children}
    </div>
  );
}

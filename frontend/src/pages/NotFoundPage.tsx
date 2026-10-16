import { ButtonLink } from '../components/ui/Button';
import { SearchIcon } from '../components/ui/icons';

/** "Content unavailable" view (iOS): a quiet glyph, a short title and one way back. */
export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-16 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-200/70 text-slate-400">
        <SearchIcon className="h-8 w-8 [&>path]:stroke-[1.8]" />
      </span>
      <div className="mt-4 text-[13px] font-semibold tabular-nums tracking-[0.08em] text-slate-400">404</div>
      <div className="mt-1 text-[22px] font-bold tracking-[-0.025em] text-slate-900">Sahifa topilmadi</div>
      <ButtonLink to="/" variant="primary" className="mt-6">
        Bosh sahifaga qaytish
      </ButtonLink>
    </div>
  );
}

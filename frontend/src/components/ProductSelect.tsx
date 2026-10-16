import { useMemo } from 'react';
import type { Ref } from '../api/types';
import { useActiveProducts } from '../lib/queries';
import { Combobox, type ComboOption } from './ui/Combobox';

interface ProductSelectProps {
  value: number | null;
  onChange: (id: number | null) => void;
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  placeholder?: string;
  /** Override the option list (e.g. only products in stock, with qty hints). */
  options?: ComboOption[];
  autoFocus?: boolean;
  /** Keep this product selectable even if it is inactive (editing old records). */
  ensure?: Ref | null;
}

/** Searchable product picker over active catalog products. */
export function ProductSelect({
  options,
  ensure,
  placeholder = 'Mahsulotni qidiring…',
  ...rest
}: ProductSelectProps) {
  const products = useActiveProducts();
  const catalogOptions = useMemo<ComboOption[]>(() => {
    const list: ComboOption[] = (products.data ?? []).map((p) => ({
      id: p.id,
      label: p.name,
      searchText: `${p.brand} ${p.model} ${p.storage} ${p.color} ${p.variant ?? ''}`,
    }));
    if (ensure && !list.some((o) => o.id === ensure.id)) {
      list.unshift({ id: ensure.id, label: ensure.name });
    }
    return list;
  }, [products.data, ensure]);
  return (
    <Combobox
      options={options ?? catalogOptions}
      loading={!options && products.isPending}
      placeholder={products.isError && !options ? "Katalogni yuklab bo'lmadi" : placeholder}
      {...rest}
    />
  );
}

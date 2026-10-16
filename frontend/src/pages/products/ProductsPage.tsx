import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../api/client';
import {
  createProduct,
  listProducts,
  productKeys,
  updateProduct,
  type Product,
  type ProductFilter,
  type ProductPatch,
} from '../../api/products';
import { Can } from '../../components/Can';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, TableWrap } from '../../components/ui/Card';
import { PencilIcon, PlusIcon } from '../../components/ui/icons';
import { Checkbox, Field, Input, Select } from '../../components/ui/Input';
import { ListRow, ListSection } from '../../components/ui/List';
import { Modal, ModalBody, ModalFooter } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { SearchField } from '../../components/ui/SearchField';
import { EmptyState, LoadingState, QueryView } from '../../components/ui/States';
import { Tabs } from '../../components/ui/Tabs';
import { useToast } from '../../components/ui/Toast';
import { useCan } from '../../lib/auth';
import { fmtQty } from '../../lib/format';
import { useDebounced } from '../../lib/useDebounced';

type ActiveFilter = 'active' | 'inactive' | 'all';

function parseActiveFilter(value: string): ActiveFilter {
  return value === 'inactive' || value === 'all' ? value : 'active';
}

const ACTIVE_TABS: { key: ActiveFilter; label: string }[] = [
  { key: 'active', label: 'Faollar' },
  { key: 'inactive', label: 'Nofaollar' },
  { key: 'all', label: 'Hammasi' },
];

/** Secondary facts for the iPhone row; the name already spells out model, memory and colour. */
function productFacts(p: Product): string {
  return [p.brand, p.storage, p.color, p.variant].filter(Boolean).join(' · ');
}

export function ProductsPage() {
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<ActiveFilter>('active');
  const q = useDebounced(search.trim(), 300);
  const filter = useMemo<ProductFilter>(
    () => ({ q: q || undefined, active: active === 'all' ? undefined : active === 'active' }),
    [q, active],
  );
  const query = useQuery({ queryKey: productKeys.list(filter), queryFn: () => listProducts(filter) });
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const can = useCan();
  const canWrite = can('catalog.write');

  const empty = (
    <EmptyState
      title={q ? `«${q}» bo'yicha mahsulot topilmadi` : "Katalog bo'sh"}
      description={q ? undefined : "Mahsulot qo'shing yoki Excel import qiling — nomlar avtomatik ajratiladi."}
    />
  );

  return (
    <div>
      <PageHeader
        title="Katalog"
        subtitle="Mahsulotlar: brend, model, xotira, rang va variant. Nomi avtomatik yig'iladi; Excel importda yangi nomlar shu yerga qo'shiladi."
        actions={
          <Can do="catalog.write">
            <Button variant="primary" icon={<PlusIcon className="h-4 w-4" />} onClick={() => setEditing('new')}>
              Mahsulot qo'shish
            </Button>
          </Can>
        }
      />
      {/* iPhone: search, segmented filter, inset-grouped list. */}
      <div className="md:hidden">
        <SearchField value={search} onChange={setSearch} placeholder="Qidirish…" className="-mt-2 mb-3" />
        <Tabs tabs={ACTIVE_TABS} value={active} onChange={setActive} />
        <QueryView query={query} isEmpty={(rows) => rows.length === 0} empty={empty} loading={<LoadingState />}>
          {(rows) => (
            <ListSection header="Mahsulotlar" footer={`Jami: ${fmtQty(rows.length)} ta mahsulot`} className="mt-2">
              {rows.map((p) => (
                <ListRow
                  key={p.id}
                  title={p.name}
                  subtitle={productFacts(p)}
                  value={p.is_active ? undefined : 'Nofaol'}
                  onClick={canWrite ? () => setEditing(p) : undefined}
                  chevron={canWrite}
                />
              ))}
            </ListSection>
          )}
        </QueryView>
      </div>

      {/* iPad / Mac: the table. */}
      <Card
        className="hidden md:block"
        title="Mahsulotlar"
        actions={
          <>
            {/* Wrapper sets the width: the shared control's own `w-full` wins over a `w-*` override. */}
            <div className="w-36">
              <Select value={active} onChange={(e) => setActive(parseActiveFilter(e.target.value))}>
                <option value="active">Faollar</option>
                <option value="inactive">Nofaollar</option>
                <option value="all">Hammasi</option>
              </Select>
            </div>
            <SearchField value={search} onChange={setSearch} placeholder="Qidirish…" className="w-60" />
          </>
        }
      >
        <QueryView query={query} isEmpty={(rows) => rows.length === 0} empty={empty}>
          {(rows) => (
            <TableWrap>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Nomi</th>
                    <th>Brend</th>
                    <th>Model</th>
                    <th>Xotira</th>
                    <th>Rang</th>
                    <th>Variant</th>
                    <th>Holati</th>
                    {canWrite && <th />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium text-slate-900">{p.name}</td>
                      <td>{p.brand}</td>
                      <td>{p.model}</td>
                      <td>{p.storage}</td>
                      <td>{p.color}</td>
                      <td>{p.variant ?? <span className="text-slate-300">—</span>}</td>
                      <td>{p.is_active ? <Badge tone="success">Faol</Badge> : <Badge>Nofaol</Badge>}</td>
                      {canWrite && (
                        <td className="w-8 text-right">
                          <IconButton label="Tahrirlash" onClick={() => setEditing(p)}>
                            <PencilIcon className="h-4 w-4" />
                          </IconButton>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={canWrite ? 8 : 7}>Jami: {fmtQty(rows.length)} ta mahsulot</td>
                  </tr>
                </tfoot>
              </table>
            </TableWrap>
          )}
        </QueryView>
      </Card>
      {editing && (
        <ProductModal
          product={editing === 'new' ? null : editing}
          brands={[...new Set((query.data ?? []).map((p) => p.brand))].sort()}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface ProductModalProps {
  product: Product | null;
  brands: string[];
  onClose: () => void;
}

function ProductModal({ product, brands, onClose }: ProductModalProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [brand, setBrand] = useState(product?.brand ?? 'Apple');
  const [model, setModel] = useState(product?.model ?? '');
  const [storage, setStorage] = useState(product?.storage ?? '');
  const [color, setColor] = useState(product?.color ?? '');
  const [variant, setVariant] = useState(product?.variant ?? '');
  const [isActive, setIsActive] = useState(product?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: ProductPatch) =>
      product
        ? updateProduct(product.id, body)
        : createProduct({
            brand: body.brand ?? '',
            model: body.model ?? '',
            storage: body.storage ?? '',
            color: body.color ?? '',
            variant: body.variant ?? null,
          }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
      toast.success(product ? `${saved.name} saqlandi` : `${saved.name} qo'shildi`);
      onClose();
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!brand.trim() || !model.trim()) {
      setError('Brend va model majburiy');
      return;
    }
    setError(null);
    const body: ProductPatch = {
      brand: brand.trim(),
      model: model.trim(),
      storage: storage.trim(),
      color: color.trim(),
      variant: variant.trim() || null,
    };
    if (product) body.is_active = isActive;
    mutation.mutate(body);
  };

  return (
    <Modal open title={product ? 'Mahsulotni tahrirlash' : "Mahsulot qo'shish"} subtitle={product?.name} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate>
        <ModalBody className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Brend" htmlFor="p-brand" required>
              <Input id="p-brand" list="p-brands" value={brand} onChange={(e) => setBrand(e.target.value)} />
              <datalist id="p-brands">
                {brands.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </Field>
            <Field label="Model" htmlFor="p-model" required hint="Masalan: iPhone 17 Pro Max">
              <Input id="p-model" value={model} onChange={(e) => setModel(e.target.value)} autoFocus={!product} />
            </Field>
            <Field label="Xotira" htmlFor="p-storage" hint="Masalan: 256GB, 1TB, 12/256GB">
              <Input id="p-storage" value={storage} onChange={(e) => setStorage(e.target.value)} />
            </Field>
            <Field label="Rang" htmlFor="p-color">
              <Input id="p-color" value={color} onChange={(e) => setColor(e.target.value)} />
            </Field>
            <Field label="Variant" htmlFor="p-variant" hint="Ixtiyoriy, masalan: eSIM">
              <Input id="p-variant" value={variant} onChange={(e) => setVariant(e.target.value)} />
            </Field>
          </div>
          {product && <Checkbox checked={isActive} onChange={setIsActive} label="Faol (tanlov ro'yxatlarida ko'rinadi)" />}
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

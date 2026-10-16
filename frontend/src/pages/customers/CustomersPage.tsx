import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import type { CustomerBalance } from '../../api/customerAccounts';
import {
  createCustomer,
  customerKeys,
  updateCustomer,
  type Customer,
  type CustomerFilter,
  type CustomerPatch,
} from '../../api/customers';
import type { CustomerKind } from '../../api/types';
import { Can } from '../../components/Can';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, TableWrap } from '../../components/ui/Card';
import { PencilIcon, PlusIcon } from '../../components/ui/icons';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/Input';
import { ListRow, ListSection } from '../../components/ui/List';
import { Modal, ModalBody, ModalFooter } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { SearchField } from '../../components/ui/SearchField';
import { EmptyState, LoadingState, QueryView } from '../../components/ui/States';
import { Tabs } from '../../components/ui/Tabs';
import { useToast } from '../../components/ui/Toast';
import { useCan } from '../../lib/auth';
import { CUSTOMER_KIND_LABELS } from '../../lib/categories';
import { fmtDate, fmtQty, fmtUsd, signClass, toNum } from '../../lib/format';
import { useCustomerBalances, useCustomerList } from '../../lib/queries';
import { useDebounced } from '../../lib/useDebounced';
import { EditControl, FILL_SEGMENTS, ValueSkeleton } from './mobile';

export function CustomersPage() {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<CustomerKind | ''>('');
  const q = useDebounced(search.trim(), 300);
  const filter = useMemo<CustomerFilter>(() => ({ q: q || undefined, kind: kind || undefined }), [q, kind]);
  const query = useCustomerList(filter);
  // Balances come from a separate endpoint: active customers plus inactive ones with debt ≠ 0 or stock > 0.
  // Rows without a balance (inactive and settled) show "—". The list still renders if this call fails.
  const balances = useCustomerBalances();
  const balanceById = useMemo(
    () => new Map((balances.data ?? []).map((b) => [b.customer.id, b])),
    [balances.data],
  );
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  // iPhone: rows open the customer; in edit mode ("Tahrirlash") they open the editor instead.
  const [editMode, setEditMode] = useState(false);
  const canWrite = useCan()('catalog.write');

  const filtered = Boolean(q || kind);
  const emptyState = (
    <EmptyState
      title={filtered ? 'Filtr bo\'yicha topilmadi' : "Hali mijoz yo'q"}
      description={filtered ? undefined : "Diler yoki xizmat mijozini qo'shing."}
    />
  );
  const balancesAlert = balances.isError && (
    <Alert tone="warning">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span>Nasiya va qoldiqni yuklab bo'lmadi: {errorMessage(balances.error)}</span>
        <Button size="xs" onClick={() => void balances.refetch()}>
          Qayta urinish
        </Button>
      </span>
    </Alert>
  );

  return (
    <div>
      <PageHeader
        title="Mijozlar"
        subtitle="Dilerlar — ulgurji xaridorlar (sotuvlarda). «Mijoz (xizmat)» — ular uchun import qilamiz (xarid qatorida tanlanadi)."
        actions={
          <Can do="catalog.write">
            <Button variant="primary" icon={<PlusIcon className="h-4 w-4" />} onClick={() => setEditing('new')}>
              Mijoz qo'shish
            </Button>
            <Button className="md:hidden" onClick={() => setEditMode((v) => !v)}>
              {editMode ? 'Tayyor' : 'Tahrirlash'}
            </Button>
          </Can>
        }
      />

      {/* iPhone: search, scope bar, inset-grouped list */}
      <div className="space-y-6 md:hidden">
        <div className="space-y-3">
          <SearchField value={search} onChange={setSearch} placeholder="Ism yoki telefon…" />
          <div className={`${FILL_SEGMENTS} [&>div]:mb-0`}>
            <Tabs tabs={KIND_SEGMENTS} value={kind || 'all'} onChange={(key) => setKind(key === 'all' ? '' : key)} />
          </div>
        </div>
        {balancesAlert}
        <QueryView
          query={query}
          isEmpty={(rows) => rows.length === 0}
          empty={emptyState}
          loading={<LoadingState />}
        >
          {(rows) => (
            <CustomerList
              rows={rows}
              balanceById={balanceById}
              balancesLoading={balances.isPending}
              balancesLoaded={Boolean(balances.data)}
              editMode={editMode && canWrite}
              onEdit={setEditing}
            />
          )}
        </QueryView>
      </div>

      <Card
        className="hidden md:block"
        title="Ro'yxat"
        subtitle={LIST_NOTE}
        actions={
          <>
            <div className="w-40">
              <Select
                value={kind}
                onChange={(e) => setKind(e.target.value === 'dealer' || e.target.value === 'client' ? e.target.value : '')}
              >
                <option value="">Barcha turlar</option>
                <option value="dealer">{CUSTOMER_KIND_LABELS.dealer}</option>
                <option value="client">{CUSTOMER_KIND_LABELS.client}</option>
              </Select>
            </div>
            <SearchField value={search} onChange={setSearch} placeholder="Ism yoki telefon…" className="w-60" />
          </>
        }
      >
        {balancesAlert && <div className="p-3">{balancesAlert}</div>}
        <QueryView query={query} isEmpty={(rows) => rows.length === 0} empty={emptyState}>
          {(rows) => {
            const totals = sumBalances(rows, balanceById);
            return (
              <TableWrap>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Nomi</th>
                      <th>Turi</th>
                      <th>Telefon</th>
                      <th className="num">Nasiya ($)</th>
                      <th className="num">Qo'lidagi mol</th>
                      <th className="num">Shu oy sotuv</th>
                      <th>Izoh</th>
                      <th>Holati</th>
                      {canWrite && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.id}>
                        <td className="font-medium">
                          <Link to={`/customers/${c.id}`} className="text-primary-700 hover:underline">
                            {c.name}
                          </Link>
                        </td>
                        <td>
                          <Badge tone={c.kind === 'dealer' ? 'primary' : 'warning'}>{CUSTOMER_KIND_LABELS[c.kind]}</Badge>
                        </td>
                        <td className="whitespace-nowrap tabular-nums">{c.phone ?? <span className="text-slate-300">—</span>}</td>
                        <BalanceCells balance={balanceById.get(c.id)} loading={balances.isPending} />
                        <td className="max-w-sm truncate text-slate-500" title={c.note ?? undefined}>
                          {c.note ?? ''}
                        </td>
                        <td>{c.is_active ? <Badge tone="success">Faol</Badge> : <Badge>Nofaol</Badge>}</td>
                        {canWrite && (
                          <td className="w-8 text-right">
                            <IconButton label="Tahrirlash" onClick={() => setEditing(c)}>
                              <PencilIcon className="h-4 w-4" />
                            </IconButton>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>Jami: {fmtQty(rows.length)}</td>
                      {balances.data ? (
                        <>
                          <td className={`num ${signClass(totals.debt, true)}`}>{fmtUsd(totals.debt)}</td>
                          <td className="num">
                            {fmtQty(totals.stockQty)} dona
                            <div className="text-[11px] font-normal text-slate-500">{fmtUsd(totals.stockValue, { symbol: true })}</div>
                          </td>
                          <td className="num">
                            {fmtUsd(totals.salesRevenue, { symbol: true })}
                            <div className="text-[11px] font-normal text-slate-500">{fmtQty(totals.salesQty)} dona</div>
                          </td>
                        </>
                      ) : (
                        <td colSpan={3} />
                      )}
                      <td colSpan={canWrite ? 3 : 2} />
                    </tr>
                  </tfoot>
                </table>
              </TableWrap>
            );
          }}
        </QueryView>
      </Card>
      {editing && <CustomerModal customer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

const LIST_NOTE =
  "Nasiya — mijoz qarzi. Qo'lidagi mol — berilgan, hali sotilmagan mol (kelishilgan narxda). Batafsil — nomini bosing.";

type KindSegment = 'all' | CustomerKind;

const KIND_SEGMENTS: { key: KindSegment; label: string }[] = [
  { key: 'all', label: 'Barcha turlar' },
  { key: 'dealer', label: CUSTOMER_KIND_LABELS.dealer },
  { key: 'client', label: CUSTOMER_KIND_LABELS.client },
];

const KIND_ORDER: CustomerKind[] = ['dealer', 'client'];

interface BalanceTotals {
  debt: number;
  stockQty: number;
  stockValue: number;
  salesQty: number;
  salesRevenue: number;
}

/** Totals over the listed customers that have a balance row. */
function sumBalances(rows: Customer[], balanceById: Map<number, CustomerBalance>): BalanceTotals {
  return rows
    .map((c) => balanceById.get(c.id))
    .filter((b): b is CustomerBalance => b !== undefined)
    .reduce<BalanceTotals>(
      (acc, b) => ({
        debt: acc.debt + toNum(b.debt),
        stockQty: acc.stockQty + b.stock_qty,
        stockValue: acc.stockValue + toNum(b.stock_value_price),
        salesQty: acc.salesQty + b.sales_month_qty,
        salesRevenue: acc.salesRevenue + toNum(b.sales_month_revenue),
      }),
      { debt: 0, stockQty: 0, stockValue: 0, salesQty: 0, salesRevenue: 0 },
    );
}

interface CustomerListProps {
  rows: Customer[];
  balanceById: Map<number, CustomerBalance>;
  balancesLoading: boolean;
  balancesLoaded: boolean;
  editMode: boolean;
  onEdit: (customer: Customer) => void;
}

/** iPhone: customers grouped by kind (Contacts-style sections), debt on the right, totals at the end. */
function CustomerList({ rows, balanceById, balancesLoading, balancesLoaded, editMode, onEdit }: CustomerListProps) {
  const groups = KIND_ORDER.map((k) => ({ kind: k, rows: rows.filter((c) => c.kind === k) })).filter(
    (g) => g.rows.length > 0,
  );
  const totals = sumBalances(rows, balanceById);
  return (
    <>
      {groups.map((g) => (
        <ListSection key={g.kind} header={`${CUSTOMER_KIND_LABELS[g.kind]} · ${fmtQty(g.rows.length)}`}>
          {g.rows.map((c) => (
            <CustomerRow
              key={c.id}
              customer={c}
              balance={balanceById.get(c.id)}
              loading={balancesLoading}
              editMode={editMode}
              onEdit={onEdit}
            />
          ))}
        </ListSection>
      ))}
      <ListSection header="Jami" footer={LIST_NOTE}>
        <ListRow title="Mijozlar" value={fmtQty(rows.length)} />
        {balancesLoaded && (
          <>
            <ListRow
              title="Nasiya"
              valueStrong
              value={<span className={signClass(totals.debt, true)}>{fmtUsd(totals.debt, { symbol: true })}</span>}
            />
            <ListRow
              title="Qo'lidagi mol"
              value={`${fmtQty(totals.stockQty)} dona`}
              valueSub={fmtUsd(totals.stockValue, { symbol: true })}
            />
            <ListRow
              title="Shu oy sotuv"
              value={fmtUsd(totals.salesRevenue, { symbol: true })}
              valueSub={`${fmtQty(totals.salesQty)} dona`}
            />
          </>
        )}
      </ListSection>
    </>
  );
}

function CustomerRow({
  customer: c,
  balance,
  loading,
  editMode,
  onEdit,
}: {
  customer: Customer;
  balance: CustomerBalance | undefined;
  loading: boolean;
  editMode: boolean;
  onEdit: (customer: Customer) => void;
}) {
  const parts: string[] = [];
  if (!c.is_active) parts.push('Nofaol');
  if (balance) {
    parts.push(`${fmtQty(balance.stock_qty)} dona`);
    parts.push(balance.last_payment_date ? `to'lov ${fmtDate(balance.last_payment_date)}` : "to'lov yo'q");
  } else if (c.phone) {
    parts.push(c.phone);
  }
  const debt = balance ? toNum(balance.debt) : 0;
  const value = balance ? (
    <span className={signClass(debt, true)}>{fmtUsd(debt, { symbol: true })}</span>
  ) : loading ? (
    <ValueSkeleton />
  ) : (
    <span className="font-normal text-slate-300">—</span>
  );
  return (
    <ListRow
      title={c.name}
      subtitle={parts.join(' · ') || undefined}
      value={value}
      valueStrong
      leading={editMode ? <EditControl /> : undefined}
      to={editMode ? undefined : `/customers/${c.id}`}
      onClick={editMode ? () => onEdit(c) : undefined}
    />
  );
}

/** Nasiya · Qo'lidagi mol · Shu oy sotuv for one customer row. */
function BalanceCells({ balance, loading }: { balance: CustomerBalance | undefined; loading: boolean }) {
  if (!balance) {
    const placeholder = loading ? (
      <span className="inline-block h-3.5 w-14 animate-pulse rounded bg-slate-100" aria-hidden="true" />
    ) : (
      <span className="text-slate-300">—</span>
    );
    return (
      <>
        <td className="num">{placeholder}</td>
        <td className="num">{placeholder}</td>
        <td className="num">{placeholder}</td>
      </>
    );
  }
  const debt = toNum(balance.debt);
  return (
    <>
      <td className={`num font-medium ${signClass(debt, true)}`}>{fmtUsd(debt)}</td>
      <td className="num">
        {balance.stock_qty > 0 ? (
          <>
            {fmtQty(balance.stock_qty)} dona
            <div className="text-[11px] text-slate-500">{fmtUsd(balance.stock_value_price, { symbol: true })}</div>
          </>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="num">
        {balance.sales_month_qty > 0 ? (
          <>
            {fmtUsd(balance.sales_month_revenue, { symbol: true })}
            <div className="text-[11px] text-slate-500">{fmtQty(balance.sales_month_qty)} dona</div>
          </>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
    </>
  );
}

function CustomerModal({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [kind, setKind] = useState<CustomerKind>(customer?.kind ?? 'dealer');
  const [note, setNote] = useState(customer?.note ?? '');
  const [isActive, setIsActive] = useState(customer?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: CustomerPatch) =>
      customer
        ? updateCustomer(customer.id, body)
        : createCustomer({ name: body.name ?? '', phone: body.phone, kind: body.kind ?? 'dealer', note: body.note }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
      toast.success(`${saved.name} saqlandi`);
      onClose();
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Nomini kiriting');
      return;
    }
    setError(null);
    const body: CustomerPatch = {
      name: name.trim(),
      phone: phone.trim() || null,
      kind,
      note: note.trim() || null,
    };
    if (customer) body.is_active = isActive;
    mutation.mutate(body);
  };

  return (
    <Modal open title={customer ? 'Mijozni tahrirlash' : "Mijoz qo'shish"} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate>
        <ModalBody className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nomi" htmlFor="c-name" required className="col-span-2">
              <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </Field>
            <Field label="Turi" htmlFor="c-kind">
              <Select id="c-kind" value={kind} onChange={(e) => setKind(e.target.value === 'client' ? 'client' : 'dealer')}>
                <option value="dealer">{CUSTOMER_KIND_LABELS.dealer}</option>
                <option value="client">{CUSTOMER_KIND_LABELS.client}</option>
              </Select>
            </Field>
            <Field label="Telefon" htmlFor="c-phone">
              <Input id="c-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998 …" />
            </Field>
            <Field label="Izoh" htmlFor="c-note" className="col-span-2">
              <Textarea id="c-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          {customer && <Checkbox checked={isActive} onChange={setIsActive} label="Faol" />}
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

import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../api/client';
import {
  listStock,
  postOpeningBalance,
  stockKeys,
  type OpeningBalanceIn,
  type OpeningBalanceResult,
} from '../../api/stock';
import { ProductSelect } from '../../components/ProductSelect';
import { Alert } from '../../components/ui/Alert';
import { Button, IconButton } from '../../components/ui/Button';
import { TableWrap } from '../../components/ui/Card';
import { PlusIcon, TrashIcon } from '../../components/ui/icons';
import { Field, Input, NumberInput } from '../../components/ui/Input';
import { ListRow, ListSection } from '../../components/ui/List';
import { Modal, ModalBody, ModalFooter } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { todayISO } from '../../lib/dates';
import { fmtDate, fmtQty, parseInputNumber } from '../../lib/format';
import { invalidateLedger, useActiveProducts } from '../../lib/queries';

interface Row {
  key: number;
  product_id: number | null;
  qty: string;
}

interface OpeningBalanceModalProps {
  onClose: () => void;
}

let rowSeq = 0;
function newRow(product_id: number | null = null, qty = ''): Row {
  rowSeq += 1;
  return { key: rowSeq, product_id, qty };
}

/**
 * Legacy stock entry (SPEC §5): per product, keep the newest `qty` own units up to
 * `as_of_date` and write off the rest. Re-running replaces earlier results.
 */
export function OpeningBalanceModal({ onClose }: OpeningBalanceModalProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const products = useActiveProducts();
  // Unfiltered stock (the page's list may be narrowed by a search).
  const stockQuery = useQuery({ queryKey: stockKeys.list(''), queryFn: () => listStock() });
  const stock = useMemo(() => stockQuery.data ?? [], [stockQuery.data]);
  const [asOf, setAsOf] = useState(todayISO());
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [submitted, setSubmitted] = useState(false);
  const [results, setResults] = useState<OpeningBalanceResult[] | null>(null);

  const productName = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of products.data ?? []) map.set(p.id, p.name);
    for (const s of stock) map.set(s.product.id, s.product.name);
    return (id: number) => map.get(id) ?? `#${id}`;
  }, [products.data, stock]);

  const rowErrors = useMemo(() => {
    const seen = new Set<number>();
    return rows.map((r) => {
      if (r.product_id === null) return 'Mahsulotni tanlang';
      if (seen.has(r.product_id)) return 'Mahsulot takrorlangan';
      seen.add(r.product_id);
      const n = parseInputNumber(r.qty);
      if (n === undefined || !Number.isInteger(n) || n < 0) return 'Soni: butun son ≥ 0';
      return null;
    });
  }, [rows]);
  const invalid = rowErrors.some((e) => e !== null) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf);

  const mutation = useMutation({
    mutationFn: (body: OpeningBalanceIn) => postOpeningBalance(body),
    onSuccess: (res) => {
      setResults(res);
      void invalidateLedger(queryClient);
      toast.success("Boshlang'ich qoldiq saqlandi");
    },
  });

  const loadFromStock = () => {
    const filled = stock.filter((s) => s.qty > 0).map((s) => newRow(s.product.id, String(s.qty)));
    setRows(filled.length > 0 ? filled : [newRow()]);
  };

  const patchRow = (key: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (invalid) return;
    mutation.mutate({
      as_of_date: asOf,
      items: rows.map((r) => ({ product_id: r.product_id ?? 0, qty: parseInputNumber(r.qty) ?? 0 })),
    });
  };

  return (
    <Modal
      open
      title="Boshlang'ich qoldiq"
      subtitle="Excel'da sotuvlar yozilmagan — hozirgi haqiqiy qoldiqni bir marta kiriting"
      onClose={onClose}
      size="lg"
    >
      {results ? (
        <>
          <ModalBody className="space-y-3">
            <Alert tone="success" title="Saqlandi">
              Har bir mahsulot bo'yicha eng yangi partiyalardagi dona qoldirildi, qolgani hisobdan chiqarildi.
            </Alert>
            {/* iPhone: a list instead of a sideways-scrolling table. */}
            <ListSection className="sm:hidden">
              {results.map((r) => (
                <ListRow
                  key={r.product_id}
                  title={productName(r.product_id)}
                  subtitle={`Hisobdan chiqarildi: ${fmtQty(r.written_off)}`}
                  value={fmtQty(r.kept)}
                  valueStrong
                  valueSub="Qoldirildi"
                />
              ))}
            </ListSection>
            <TableWrap className="hidden sm:block">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Mahsulot</th>
                    <th className="num">Qoldirildi</th>
                    <th className="num">Hisobdan chiqarildi</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.product_id}>
                      <td>{productName(r.product_id)}</td>
                      <td className="num font-medium">{fmtQty(r.kept)}</td>
                      <td className="num">{fmtQty(r.written_off)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </ModalBody>
          <ModalFooter>
            <Button variant="primary" onClick={onClose}>
              Yopish
            </Button>
          </ModalFooter>
        </>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <ModalBody className="space-y-4">
            <Alert tone="info">
              Har bir mahsulot uchun <b>{fmtDate(asOf)}</b> holatidagi haqiqiy sonni kiriting. Tizim shu sanagacha bo'lgan
              eng yangi partiyalardagi donalarni qoldiradi, eskilarini «boshlang'ich qoldiq» sababi bilan hisobdan
              chiqaradi (FIFO). Qayta yuborilsa, shu mahsulot uchun oldingi natija almashtiriladi. Son shu sanadan
              keyin sotilgan donadan kam va sotib olingan donadan ko'p bo'lmasligi kerak.
            </Alert>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <Field label="Sana holatiga" htmlFor="ob-date">
                <Input id="ob-date" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-40" />
              </Field>
              {stock.length > 0 && (
                <Button size="sm" variant="ghost" onClick={loadFromStock}>
                  Ombordagi qoldiqni yuklash
                </Button>
              )}
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-[minmax(0,1fr)_96px_36px] gap-2 text-[12px] font-medium text-slate-500 sm:grid-cols-[minmax(0,1fr)_120px_32px]">
                <div>Mahsulot</div>
                <div className="text-right">Haqiqiy qoldiq</div>
                <div />
              </div>
              {rows.map((r, idx) => (
                <div key={r.key}>
                  <div className="grid grid-cols-[minmax(0,1fr)_96px_36px] items-start gap-2 sm:grid-cols-[minmax(0,1fr)_120px_32px]">
                    <ProductSelect
                      value={r.product_id}
                      onChange={(id) => patchRow(r.key, { product_id: id })}
                      invalid={submitted && rowErrors[idx] !== null && r.product_id === null}
                    />
                    <NumberInput
                      aria-label="Haqiqiy qoldiq"
                      inputMode="numeric"
                      value={r.qty}
                      invalid={submitted && rowErrors[idx] !== null && r.product_id !== null}
                      onChange={(e) => patchRow(r.key, { qty: e.target.value })}
                    />
                    <IconButton
                      label="O'chirish"
                      tone="danger"
                      className="mt-1"
                      disabled={rows.length === 1}
                      onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </IconButton>
                  </div>
                  {submitted && rowErrors[idx] && (
                    <div className="mt-0.5 text-xs text-danger-600">{rowErrors[idx]}</div>
                  )}
                </div>
              ))}
              <Button
                size="sm"
                variant="ghost"
                icon={<PlusIcon className="h-3.5 w-3.5" />}
                onClick={() => setRows((prev) => [...prev, newRow()])}
              >
                Mahsulot qo'shish
              </Button>
            </div>
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
      )}
    </Modal>
  );
}

import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { deleteSale, getSale, saleKeys } from '../../api/sales';
import { Can } from '../../components/Can';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, TableWrap } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { TrashIcon } from '../../components/ui/icons';
import { ListRow, ListSection } from '../../components/ui/List';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { StatCard } from '../../components/ui/StatCard';
import { useToast } from '../../components/ui/Toast';
import { SALE_SOURCE_LABELS } from '../../lib/categories';
import { fmtDate, fmtPct, fmtQty, fmtUsd, signClass, toNum } from '../../lib/format';
import { invalidateLedger } from '../../lib/queries';

export function SaleDetailPage() {
  const params = useParams();
  const saleId = Number(params.saleId);
  const valid = Number.isInteger(saleId) && saleId > 0;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const query = useQuery({ queryKey: saleKeys.detail(saleId), queryFn: () => getSale(saleId), enabled: valid });

  const remove = useMutation({
    mutationFn: () => deleteSale(saleId),
    onSuccess: () => {
      const fromCustomer = query.data?.source === 'consignment';
      queryClient.removeQueries({ queryKey: saleKeys.detail(saleId) });
      void invalidateLedger(queryClient);
      toast.success(
        fromCustomer
          ? "Sotuv o'chirildi, mahsulotlar mijoz omboriga qaytdi"
          : "Sotuv o'chirildi, mahsulotlar omborga qaytdi",
      );
      navigate('/sales', { replace: true });
    },
  });

  const back = { to: '/sales', label: 'Sotuvlar' };

  if (!valid) {
    return (
      <div>
        <PageHeader title="Sotuv" back={back} />
        <EmptyState title="Sotuv topilmadi" description="Havola noto'g'ri." />
      </div>
    );
  }
  if (query.isPending) {
    return (
      <div>
        <PageHeader title="Sotuv" back={back} />
        <LoadingState rows={8} />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div>
        <PageHeader title="Sotuv" back={back} />
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      </div>
    );
  }

  const sale = query.data;
  const t = sale.totals;
  const revenue = toNum(t.revenue);
  const consignment = sale.source === 'consignment';

  return (
    <div className="space-y-4">
      <PageHeader
        back={back}
        title={
          <span className="flex flex-wrap items-center gap-2">
            Sotuv №{sale.id} · {fmtDate(sale.sale_date)}
            {consignment && <Badge tone="primary">{SALE_SOURCE_LABELS.consignment}</Badge>}
          </span>
        }
        subtitle={
          <>
            {sale.customer ? `Mijoz: ${sale.customer.name}` : 'Mijoz tanlanmagan'}
            {sale.note ? ` · ${sale.note}` : ''}
          </>
        }
        actions={
          <Can do="sales.delete">
            <Button
              size="sm"
              variant="ghost"
              className="hidden text-danger-600 hover:bg-danger-50 hover:text-danger-700 md:inline-flex"
              icon={<TrashIcon className="h-3.5 w-3.5" />}
              onClick={() => setConfirmDelete(true)}
            >
              O'chirish
            </Button>
          </Can>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Soni" value={`${fmtQty(t.qty)} dona`} />
        <StatCard label="Tushum" value={fmtUsd(t.revenue, { symbol: true })} />
        <StatCard label="Tannarx (FIFO)" value={fmtUsd(t.cost, { symbol: true })} />
        <StatCard
          label="Foyda"
          value={fmtUsd(t.profit, { symbol: true })}
          valueClassName={signClass(t.profit)}
          sub={revenue !== 0 ? `marja ${fmtPct(toNum(t.profit) / revenue, 1)}` : undefined}
        />
      </div>

      {/* iPhone: one row per line, its batch allocations under it. */}
      <ListSection
        className="pt-4 md:hidden"
        header="Mahsulotlar va partiyalar bo'yicha taqsimot"
        footer="Tannarx partiyaning joriy amaldagi tannarxidan olinadi: real xarajatlar kiritilsa foyda o'zgaradi."
      >
        {sale.lines.length === 0 ? (
          <li>
            <EmptyState title="Qatorlar yo'q" />
          </li>
        ) : (
          sale.lines.map((l) => (
            <ListRow
              key={l.id}
              title={<span className="block whitespace-normal">{l.product.name}</span>}
              subtitle={
                <>
                  <span className="block truncate">
                    {fmtQty(l.qty)} dona × {fmtUsd(l.price_usd)} $
                  </span>
                  <span className="block truncate">tannarx {fmtUsd(l.cost)} $</span>
                  {l.allocations.map((a) => (
                    <span key={a.purchase_line_id} className="block truncate text-slate-400">
                      ↳ Partiya {fmtDate(a.batch_date)} · {fmtQty(a.qty)} × {fmtUsd(a.unit_cost)}
                    </span>
                  ))}
                </>
              }
              value={fmtUsd(l.revenue, { symbol: true })}
              valueStrong
              valueSub={<span className={signClass(l.profit)}>foyda {fmtUsd(l.profit)}</span>}
            />
          ))
        )}
      </ListSection>

      <Can do="sales.delete">
        <ListSection className="pt-4 md:hidden">
          <ListRow title="O'chirish" tone="danger" center onClick={() => setConfirmDelete(true)} />
        </ListSection>
      </Can>

      <Card
        className="hidden md:block"
        title="Mahsulotlar va partiyalar bo'yicha taqsimot"
        subtitle="Tannarx partiyaning joriy amaldagi tannarxidan olinadi: real xarajatlar kiritilsa foyda o'zgaradi."
      >
        {sale.lines.length === 0 ? (
          <EmptyState title="Qatorlar yo'q" />
        ) : (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Mahsulot / partiya</th>
                  <th className="num">Soni</th>
                  <th className="num">Narx / tannarx ($)</th>
                  <th className="num">Tushum ($)</th>
                  <th className="num">Tannarx ($)</th>
                  <th className="num">Foyda ($)</th>
                </tr>
              </thead>
              <tbody>
                {sale.lines.map((l) => (
                  <Fragment key={l.id}>
                    <tr>
                      <td className="font-medium text-slate-900">{l.product.name}</td>
                      <td className="num font-medium">{fmtQty(l.qty)}</td>
                      <td className="num">{fmtUsd(l.price_usd)}</td>
                      <td className="num">{fmtUsd(l.revenue)}</td>
                      <td className="num">{fmtUsd(l.cost)}</td>
                      <td className={`num font-semibold ${signClass(l.profit)}`}>{fmtUsd(l.profit)}</td>
                    </tr>
                    {l.allocations.map((a) => (
                      <tr key={`${l.id}-${a.purchase_line_id}`} className="tbl-sub text-slate-500">
                        <td className="pl-6 text-xs">↳ Partiya {fmtDate(a.batch_date)}</td>
                        <td className="num text-xs">{fmtQty(a.qty)}</td>
                        <td className="num text-xs">{fmtUsd(a.unit_cost)}</td>
                        <td />
                        <td className="num text-xs">{fmtUsd(toNum(a.unit_cost) * a.qty)}</td>
                        <td />
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Jami</td>
                  <td className="num">{fmtQty(t.qty)}</td>
                  <td />
                  <td className="num">{fmtUsd(t.revenue)}</td>
                  <td className="num">{fmtUsd(t.cost)}</td>
                  <td className={`num ${signClass(t.profit)}`}>{fmtUsd(t.profit)}</td>
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        )}
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        title="Sotuvni o'chirish"
        message={`Sotuv №${sale.id} (${fmtQty(t.qty)} dona) o'chirilsinmi? ${
          consignment ? 'Mahsulotlar mijoz omboriga qaytadi.' : 'Mahsulotlar omborga qaytadi.'
        }`}
        loading={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : null}
        onConfirm={() => remove.mutate()}
        onClose={() => {
          setConfirmDelete(false);
          remove.reset();
        }}
      />
    </div>
  );
}

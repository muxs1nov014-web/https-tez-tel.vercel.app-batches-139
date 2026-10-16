import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { CustomerOverview, PaymentKind } from '../../api/customerAccounts';
import { Can } from '../../components/Can';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { BanknotesIcon, CartIcon, CubeIcon, PlusIcon, WalletIcon } from '../../components/ui/icons';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { StatCard } from '../../components/ui/StatCard';
import { Tabs } from '../../components/ui/Tabs';
import { CUSTOMER_KIND_LABELS } from '../../lib/categories';
import { fmtDate, fmtQty, fmtUsd, signClass } from '../../lib/format';
import { useCustomerOverview } from '../../lib/queries';
import { ConsignmentModal, type ConsignmentMode } from './ConsignmentModal';
import { CustomerLedgerTab } from './CustomerLedgerTab';
import { CustomerMovesTab } from './CustomerMovesTab';
import { CustomerPaymentsTab } from './CustomerPaymentsTab';
import { CustomerSalesTab } from './CustomerSalesTab';
import { CustomerStockTab } from './CustomerStockTab';
import { FILL_SEGMENTS } from './mobile';
import { PaymentModal } from './PaymentModal';

type TabKey = 'stock' | 'moves' | 'sales' | 'payments' | 'ledger';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'stock', label: 'Qoldiq' },
  { key: 'moves', label: 'Harakatlar' },
  { key: 'sales', label: 'Sotuvlar' },
  { key: 'payments', label: "To'lovlar" },
  { key: 'ledger', label: 'Hisob-kitob' },
];

function parseTab(value: string | null): TabKey {
  return TABS.find((t) => t.key === value)?.key ?? 'stock';
}

type ModalState = { type: 'consignment'; mode: ConsignmentMode } | { type: 'payment'; kind: PaymentKind } | null;

/** After a save, show the tab where the new record is listed. */
const TAB_AFTER_CONSIGNMENT: Record<ConsignmentMode, TabKey> = { out: 'moves', return: 'moves', sold: 'sales' };

const BACK = { to: '/customers', label: 'Mijozlar' };

export function CustomerDetailPage() {
  const params = useParams();
  const customerId = Number(params.customerId);
  const valid = Number.isInteger(customerId) && customerId > 0;
  const query = useCustomerOverview(customerId, valid);

  if (!valid) {
    return (
      <div>
        <PageHeader title="Mijoz" back={BACK} />
        <EmptyState title="Mijoz topilmadi" description="Havola noto'g'ri." />
      </div>
    );
  }
  if (query.isPending) {
    return (
      <div>
        <PageHeader title="Mijoz" back={BACK} />
        <LoadingState rows={8} />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div>
        <PageHeader title="Mijoz" back={BACK} />
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      </div>
    );
  }
  return <CustomerDetailView customerId={customerId} overview={query.data} />;
}

function CustomerDetailView({ customerId, overview }: { customerId: number; overview: CustomerOverview }) {
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get('tab'));
  const setTab = (key: TabKey) => setParams({ tab: key }, { replace: true });
  const [modal, setModal] = useState<ModalState>(null);

  const b = overview.balance;
  const customer = b.customer;
  const openConsignment = (mode: ConsignmentMode) => setModal({ type: 'consignment', mode });
  const openPayment = (kind: PaymentKind) => setModal({ type: 'payment', kind });

  return (
    <div className="space-y-4">
      <PageHeader
        back={BACK}
        title={customer.name}
        subtitle={
          <>
            <span className="mr-2 inline-flex -translate-y-px align-middle">
              <Badge tone={customer.kind === 'dealer' ? 'primary' : 'warning'}>{CUSTOMER_KIND_LABELS[customer.kind]}</Badge>
            </span>
            Mijoz ombori va nasiya. Berilgan mol bizniki — mijoz sotgach, nasiyaga yoziladi.
            {/* iPhone: one row of equal capsules, the primary action first */}
            <span className="mt-4 grid auto-cols-fr grid-flow-col gap-2 empty:hidden md:hidden">
              <Can do="customerMoves.write">
                <Button variant="primary" className="!px-1" onClick={() => openConsignment('out')}>
                  Mol berish
                </Button>
                <Button className="!px-1" onClick={() => openConsignment('return')}>
                  Qaytarish
                </Button>
                <Button className="!px-1" onClick={() => openConsignment('sold')}>
                  Sotildi
                </Button>
              </Can>
              <Can do="customerPayments.write">
                <Button className="!px-1" onClick={() => openPayment('payment')}>
                  To'lov
                </Button>
              </Can>
            </span>
          </>
        }
        actions={
          <div className="hidden flex-wrap items-center gap-2 md:flex">
            <Can do="customerMoves.write">
              <Button variant="primary" icon={<PlusIcon className="h-4 w-4" />} onClick={() => openConsignment('out')}>
                Mol berish
              </Button>
              <Button onClick={() => openConsignment('return')}>Qaytarish</Button>
              <Button onClick={() => openConsignment('sold')}>Sotildi</Button>
            </Can>
            <Can do="customerPayments.write">
              <Button variant="subtle" onClick={() => openPayment('payment')}>
                To'lov
              </Button>
              <Button variant="ghost" onClick={() => openPayment('opening_debt')}>
                Boshlang'ich qarz
              </Button>
            </Can>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          icon={WalletIcon}
          tint="red"
          label="Nasiya"
          value={fmtUsd(b.debt, { symbol: true })}
          valueClassName={signClass(b.debt, true)}
          sub={b.last_payment_date ? `Oxirgi to'lov: ${fmtDate(b.last_payment_date)}` : "To'lov hali yo'q"}
        />
        <StatCard
          icon={CubeIcon}
          tint="brown"
          label="Qo'lidagi mol"
          value={`${fmtQty(b.stock_qty)} dona`}
          sub={
            <>
              {fmtUsd(b.stock_value_price, { symbol: true })} narxda · tannarx {fmtUsd(b.stock_value_cost, { symbol: true })}
            </>
          }
        />
        <StatCard
          icon={BanknotesIcon}
          tint="purple"
          label="Jami majburiyat"
          value={fmtUsd(b.exposure, { symbol: true })}
          sub="Nasiya + qo'lidagi mol (narxda)"
        />
        <StatCard
          icon={CartIcon}
          tint="pink"
          label="Shu oy sotuv"
          value={fmtUsd(b.sales_month_revenue, { symbol: true })}
          sub={`${fmtQty(b.sales_month_qty)} dona`}
        />
      </div>

      <div>
        <div className={FILL_SEGMENTS}>
          <Tabs tabs={TABS} value={tab} onChange={setTab} />
        </div>
        {tab === 'stock' && <CustomerStockTab customerId={customerId} onGive={() => openConsignment('out')} />}
        {tab === 'moves' && (
          <CustomerMovesTab customerId={customerId} totals={overview.totals} onGive={() => openConsignment('out')} />
        )}
        {tab === 'sales' && <CustomerSalesTab customerId={customerId} onSold={() => openConsignment('sold')} />}
        {tab === 'payments' && (
          <CustomerPaymentsTab
            customerId={customerId}
            onPay={() => openPayment('payment')}
            onOpeningDebt={() => openPayment('opening_debt')}
          />
        )}
        {tab === 'ledger' && <CustomerLedgerTab customerId={customerId} totals={overview.totals} debt={b.debt} />}
      </div>

      {modal?.type === 'consignment' && (
        <ConsignmentModal
          mode={modal.mode}
          customerId={customerId}
          customerName={customer.name}
          onClose={() => setModal(null)}
          onSaved={(mode) => {
            setModal(null);
            setTab(TAB_AFTER_CONSIGNMENT[mode]);
          }}
        />
      )}
      {modal?.type === 'payment' && (
        <PaymentModal
          kind={modal.kind}
          customerId={customerId}
          customerName={customer.name}
          debt={b.debt}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            setTab('payments');
          }}
        />
      )}
    </div>
  );
}

import { useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Tabs } from '../../components/ui/Tabs';
import { todayISO, type DateRangeValue } from '../../lib/dates';
import { ClientsReport } from './ClientsReport';
import { PickerRow } from './FormRows';
import { ProfitReport } from './ProfitReport';
import { UnitCostReport } from './UnitCostReport';
import { VarianceReport } from './VarianceReport';

type TabKey = 'profit' | 'variance' | 'unit-cost' | 'clients';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'profit', label: 'Foyda' },
  { key: 'variance', label: 'Taxminiy vs real' },
  { key: 'unit-cost', label: 'Tannarx tarixi' },
  { key: 'clients', label: 'Mijoz xizmati' },
];

function parseTab(value: string | null): TabKey {
  return TABS.find((t) => t.key === value)?.key ?? 'profit';
}

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get('tab'));
  // Shared across tabs so switching keeps the period.
  const [range, setRange] = useState<DateRangeValue>({
    date_from: `${new Date().getFullYear()}-01-01`,
    date_to: todayISO(),
  });

  const selectTab = (key: TabKey) => setParams({ tab: key }, { replace: true });
  const picker = <PickerRow label="Hisobot" value={tab} options={TABS} onChange={selectTab} />;

  return (
    <div>
      <PageHeader title="Hisobotlar" subtitle="Foyda, xarajatlar farqi, tannarx dinamikasi va mijozlar uchun import xizmati." />
      {/* Four long segments do not fit an iPhone: there the report is a menu picker in the filter form. */}
      <div className="hidden md:block">
        <Tabs tabs={TABS} value={tab} onChange={selectTab} />
      </div>
      {tab === 'profit' && <ProfitReport range={range} onRangeChange={setRange} lead={picker} />}
      {tab === 'variance' && <VarianceReport range={range} onRangeChange={setRange} lead={picker} />}
      {tab === 'unit-cost' && <UnitCostReport lead={picker} />}
      {tab === 'clients' && <ClientsReport range={range} onRangeChange={setRange} lead={picker} />}
    </div>
  );
}

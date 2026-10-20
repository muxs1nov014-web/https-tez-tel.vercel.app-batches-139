import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getNasiyaOverview, nasiyaKeys } from '../../api/nasiya';
import { Alert } from '../../components/ui/Alert';
import { Card } from '../../components/ui/Card';
import { BanknotesIcon, ClipboardCheckIcon, TrendUpIcon, WarningIcon } from '../../components/ui/icons';
import { StatCard } from '../../components/ui/StatCard';
import { fmtDate, fmtQty, fmtUsd, toNum } from '../../lib/format';

/** Dashboard block: the latest confirmed nasiya day (SPEC §18). Loads on its own, so it never holds the page. */
export function NasiyaDashboardCard() {
  const query = useQuery({ queryKey: nasiyaKeys.overview(), queryFn: () => getNasiyaOverview() });
  const data = query.data;
  if (!data || (!data.report && data.pending_reports === 0)) return null;
  const t = data.totals;
  const newDebt = data.counts
    .filter((c) => c.type === 'new_debt' || c.type === 'qoldiq_to_debt')
    .reduce((s, c) => s + toNum(c.amount), 0);
  const overLimit = data.customers.filter((c) => c.over_limit).length;

  return (
    <Card
      title={
        <Link to="/nasiya" className="hover:text-primary-700">
          Nasiya nazorati{data.report ? ` · ${fmtDate(data.report.report_date)}` : ''}
        </Link>
      }
      subtitle="«Telefon nasiya nazorat» guruhidagi oxirgi tasdiqlangan kun."
      className="[&>div]:bg-transparent [&>div]:shadow-none dark:[&>div]:ring-0"
    >
      <div className="space-y-3">
        {data.pending_reports > 0 && (
          <Alert tone="warning">
            {data.pending_reports} ta yangi hisobot tekshirishni kutmoqda.{' '}
            <Link to="/nasiya?tab=reports" className="font-medium underline">
              Ochish
            </Link>
          </Alert>
        )}
        {t && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard icon={BanknotesIcon} tint="orange" label="Jami nasiya" value={fmtUsd(t.debt_usd, { symbol: true })} sub={`${fmtQty(t.debt_qty)} dona`} />
            <StatCard icon={TrendUpIcon} tint="green" label="To'landi" value={fmtUsd(t.sotuv_usd, { symbol: true })} sub={`${fmtQty(t.sotuv_qty)} dona`} />
            <StatCard icon={ClipboardCheckIcon} tint="blue" label="Yangi nasiya" value={fmtUsd(newDebt, { symbol: true })} sub={`qoldiq ${fmtQty(t.qoldiq_qty)} dona`} />
            <StatCard
              icon={WarningIcon}
              tint="red"
              label="Ogohlantirish"
              value={fmtQty(data.alerts.length)}
              valueClassName={data.alerts.length ? 'text-danger-600' : 'text-slate-900'}
              sub={overLimit ? `${overLimit} mijoz limitdan oshgan` : 'limitdan oshgan yo\'q'}
            />
          </div>
        )}
      </div>
    </Card>
  );
}

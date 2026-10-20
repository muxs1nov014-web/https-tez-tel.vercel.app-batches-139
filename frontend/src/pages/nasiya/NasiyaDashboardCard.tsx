import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getNasiyaMonths, getNasiyaOverview, nasiyaKeys } from '../../api/nasiya';
import { Can } from '../../components/Can';
import { Alert } from '../../components/ui/Alert';
import { Card } from '../../components/ui/Card';
import { BanknotesIcon, CartIcon, ClipboardCheckIcon, CubeIcon, WarningIcon } from '../../components/ui/icons';
import { StatCard } from '../../components/ui/StatCard';
import { startOfMonthISO } from '../../lib/dates';
import { fmtDate, fmtMonth, fmtQty, fmtUsd } from '../../lib/format';
import { ProcessButton } from './ProcessButton';

/** Dashboard block: the group's daily Excel (SPEC §18) — latest confirmed day and this month. Loads on its own. */
export function NasiyaDashboardCard() {
  const overview = useQuery({ queryKey: nasiyaKeys.overview(), queryFn: () => getNasiyaOverview() });
  const months = useQuery({ queryKey: nasiyaKeys.months(), queryFn: () => getNasiyaMonths() });
  const data = overview.data;
  if (!data) return null;
  const t = data.totals;
  const thisMonth = startOfMonthISO();
  const month = months.data?.find((m) => m.month === thisMonth);
  const overLimit = data.customers.filter((c) => c.over_limit).length;

  return (
    <Card
      title={
        <Link to="/nasiya" className="hover:text-primary-700">
          Nasiya nazorati{data.report ? ` · ${fmtDate(data.report.report_date)}` : ''}
        </Link>
      }
      subtitle="«Telefon nasiya nazorat» guruhidagi kunlik Excel: oxirgi hisoblangan kun va shu oy."
      actions={
        <Can do="nasiya.review">
          <ProcessButton variant="subtle" />
        </Can>
      }
      className="[&>div]:bg-transparent [&>div]:shadow-none dark:[&>div]:ring-0"
    >
      <div className="space-y-3">
        {data.pending_reports > 0 && (
          <Alert tone="warning">
            {data.pending_reports} ta hisobot hali hisoblanmagan.{' '}
            <Link to="/nasiya?tab=reports" className="font-medium underline">
              Ochish
            </Link>
          </Alert>
        )}
        {data.report && data.report.error_count > 0 && (
          <Alert tone="warning">
            {fmtDate(data.report.report_date)} faylida {fmtQty(data.report.error_count)} ta xato bor — kun hisoblandi,
            lekin xatolarni tekshiring.{' '}
            <Link to={`/nasiya/reports/${data.report.id}`} className="font-medium underline">
              Hisobotni ochish
            </Link>
          </Alert>
        )}
        {!t ? (
          <p className="px-1 text-[13px] text-slate-500">
            Hali hisoblangan kun yo'q. «Hammasini hisoblash» guruhdagi fayllarni o'qib, har bir kunni hisoblaydi.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <StatCard
              icon={BanknotesIcon}
              tint="orange"
              label="Jami nasiya"
              value={fmtUsd(t.debt_usd, { symbol: true })}
              sub={`${fmtQty(t.debt_qty)} dona`}
            />
            <StatCard icon={CubeIcon} tint="brown" label="Qoldiq (mijozlarda)" value={`${fmtQty(t.qoldiq_qty)} dona`} sub={fmtDate(data.report?.report_date)} />
            <StatCard
              icon={CartIcon}
              tint="green"
              label={`Sotuv · ${fmtMonth(thisMonth)}`}
              value={fmtUsd(month?.sotuv_usd ?? 0, { symbol: true })}
              sub={`${fmtQty(month?.sotuv_qty ?? 0)} dona to'landi`}
            />
            <StatCard
              icon={ClipboardCheckIcon}
              tint="blue"
              label={`Yangi nasiya · ${fmtMonth(thisMonth)}`}
              value={fmtUsd(month?.new_debt_usd ?? 0, { symbol: true })}
              sub={`${fmtQty(month?.new_debt_qty ?? 0)} dona`}
            />
            <StatCard
              icon={WarningIcon}
              tint="red"
              label="Ogohlantirish"
              value={fmtQty(data.alerts.length)}
              valueClassName={data.alerts.length ? 'text-danger-600' : 'text-slate-900'}
              sub={overLimit ? `${overLimit} mijoz limitdan oshgan` : "limitdan oshgan yo'q"}
            />
          </div>
        )}
      </div>
    </Card>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getNasiyaCustomer, getNasiyaMonths, nasiyaKeys } from '../../api/nasiya';
import { Card } from '../../components/ui/Card';
import { BanknotesIcon, CartIcon, ClipboardCheckIcon, CubeIcon } from '../../components/ui/icons';
import { StatCard } from '../../components/ui/StatCard';
import { startOfMonthISO } from '../../lib/dates';
import { fmtDate, fmtMonth, fmtQty, fmtUsd, toNum } from '../../lib/format';

/** The customer's figures from the group's daily Excel (SPEC §18) on the customer page. Hidden when the customer
 *  has no sheet in the latest confirmed day. */
export function NasiyaCustomerBlock({ customerId }: { customerId: number }) {
  const detail = useQuery({ queryKey: nasiyaKeys.customer(customerId), queryFn: () => getNasiyaCustomer(customerId) });
  const months = useQuery({ queryKey: nasiyaKeys.months(customerId), queryFn: () => getNasiyaMonths(customerId) });
  const row = detail.data?.row;
  if (!row || !detail.data?.report) return null;
  const t = row.totals;
  const thisMonth = startOfMonthISO();
  const month = months.data?.find((m) => m.month === thisMonth);

  return (
    <Card
      title={`Guruh hisoboti · ${fmtDate(detail.data.report.report_date)}`}
      subtitle={`«${row.sheet_name}» varag'i: har bir telefon IMEI bo'yicha.`}
      actions={
        <Link to={`/nasiya/customers/${customerId}`} className="text-[13px] font-medium text-primary-700 hover:underline">
          Batafsil
        </Link>
      }
      className="[&>div]:bg-transparent [&>div]:shadow-none dark:[&>div]:ring-0"
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          icon={BanknotesIcon}
          tint="orange"
          label="Nasiya"
          value={fmtUsd(t.debt_usd, { symbol: true })}
          sub={
            <>
              {fmtQty(t.debt_qty)} dona
              {toNum(t.variant_usd) > 0 && <> · variant {fmtUsd(t.variant_usd, { symbol: true, decimals: 0 })}</>}
            </>
          }
        />
        <StatCard
          icon={CubeIcon}
          tint="brown"
          label="Qoldiq"
          value={`${fmtQty(t.qoldiq_qty)} dona`}
          sub={toNum(t.qoldiq_value_usd) > 0 ? fmtUsd(t.qoldiq_value_usd, { symbol: true }) : 'mijoz qo\'lidagi mol'}
        />
        <StatCard
          icon={CartIcon}
          tint="green"
          label={`Sotuv · ${fmtMonth(thisMonth)}`}
          value={fmtUsd(month?.sotuv_usd ?? 0, { symbol: true })}
          sub={`${fmtQty(month?.sotuv_qty ?? 0)} dona to'landi · bugun ${fmtQty(t.sotuv_qty)}`}
        />
        <StatCard
          icon={ClipboardCheckIcon}
          tint={row.over_limit ? 'red' : 'blue'}
          label="Limit"
          value={row.limit_usd != null ? fmtUsd(row.limit_usd, { symbol: true }) : '—'}
          valueClassName={row.over_limit ? 'text-danger-600' : undefined}
          sub={
            row.available_usd != null
              ? `${row.over_limit ? 'oshgan' : "bo'sh"}: ${fmtUsd(Math.abs(toNum(row.available_usd)), { symbol: true })}`
              : `jami ${fmtUsd(row.exposure_usd, { symbol: true })}`
          }
        />
      </div>
    </Card>
  );
}

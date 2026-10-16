import type { BatchCategory, LineOut } from '../../api/batches';
import { ListRow, ListSection } from '../../components/ui/List';
import { Modal, ModalBody } from '../../components/ui/Modal';
import { fmtAed, fmtPct, fmtQty, fmtRate, fmtUsd, signClass, toNum } from '../../lib/format';
import { lineBreakdown } from './LineBreakdown';
import { SHEET_SECTION } from './sheet';

const EPS = 0.005;

interface LineSheetProps {
  line: LineOut;
  categories: BatchCategory[];
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** iPhone counterpart of the expandable table row: one line's price, per-unit costs and stock as a bottom sheet. */
export function LineSheet({ line, categories, canEdit, canDelete, onClose, onEdit, onDelete }: LineSheetProps) {
  const { visible, hiddenCount, serviceFee, charge, margin } = lineBreakdown(line, categories);
  const overheadDiff = toNum(line.overhead) - toNum(line.overhead_est);
  const costDiff = toNum(line.unit_cost) - toNum(line.unit_cost_est);

  return (
    <Modal
      open
      title={line.product.name}
      subtitle={`${fmtQty(line.qty)} dona · ${line.channel?.name ?? '—'}`}
      onClose={onClose}
    >
      <ModalBody className="space-y-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <ListSection header="Narx" className={SHEET_SECTION}>
          <ListRow title="Narx (AED)" value={fmtAed(line.price_aed, { symbol: true })} />
          <ListRow title="Kurs" value={fmtRate(line.rate)} />
          <ListRow title="Narx ($)" value={fmtUsd(line.price_usd, { symbol: true })} valueStrong />
        </ListSection>

        <ListSection
          header="Ustama / dona"
          footer={hiddenCount > 0 ? `Yana ${hiddenCount} ta kategoriya bo'yicha xarajat yo'q (0).` : undefined}
          className={SHEET_SECTION}
        >
          {visible.map((r) => (
            <ListRow
              key={r.category.code}
              title={
                <>
                  {r.category.label}
                  {r.category.code === 'perevod' && (
                    <span className="text-slate-500"> ({fmtPct(line.estimates.perevod_pct)})</span>
                  )}
                </>
              }
              value={fmtUsd(r.effective, { symbol: true })}
              valueSub={
                Math.abs(r.diff) >= EPS ? (
                  <span className={signClass(r.diff, true)}>taxminiy {fmtUsd(r.estimate)}</span>
                ) : undefined
              }
            />
          ))}
          <ListRow
            title={<span className="font-semibold">Ustama / dona</span>}
            value={fmtUsd(line.overhead, { symbol: true })}
            valueStrong
            valueSub={
              Math.abs(overheadDiff) >= EPS ? (
                <span className={signClass(overheadDiff, true)}>taxminiy {fmtUsd(line.overhead_est)}</span>
              ) : undefined
            }
          />
        </ListSection>

        <ListSection className={SHEET_SECTION}>
          <ListRow
            title={<span className="font-semibold">Tannarx / dona</span>}
            value={fmtUsd(line.unit_cost, { symbol: true })}
            valueStrong
            valueSub={
              Math.abs(costDiff) >= EPS ? (
                <span className={signClass(costDiff, true)}>taxminiy {fmtUsd(line.unit_cost_est)}</span>
              ) : (
                `× ${fmtQty(line.qty)} = ${fmtUsd(toNum(line.unit_cost) * line.qty, { symbol: true })}`
              )
            }
          />
        </ListSection>

        {line.client ? (
          <ListSection header={`Mijoz: ${line.client.name}`} className={SHEET_SECTION}>
            {serviceFee !== null && charge !== null && margin !== null && (
              <>
                <ListRow
                  title="Xizmat haqi"
                  value={fmtUsd(serviceFee, { symbol: true })}
                  valueSub={`${fmtPct(line.service_pct)} · dona`}
                />
                <ListRow title="Mijozga hisob" value={fmtUsd(charge, { symbol: true })} valueSub="dona" />
                <ListRow
                  title="Marja"
                  value={<span className={signClass(margin)}>{fmtUsd(margin, { symbol: true })}</span>}
                  valueStrong
                />
              </>
            )}
            {(serviceFee === null || charge === null || margin === null) && (
              <ListRow title="Mijoz" value={line.client.name} />
            )}
          </ListSection>
        ) : (
          <ListSection header="Qoldiq" className={SHEET_SECTION}>
            <ListRow title="Sotilgan" value={`${fmtQty(line.sold_qty)} dona`} />
            <ListRow title="Hisobdan chiqarilgan" value={`${fmtQty(line.adjusted_qty)} dona`} />
            <ListRow title="Mijozlarda" value={`${fmtQty(line.consigned_qty ?? 0)} dona`} />
            <ListRow title="Qoldiq" value={`${fmtQty(line.remaining_qty)} dona`} valueStrong />
          </ListSection>
        )}

        {(line.raw_name || line.note) && (
          <ListSection className={SHEET_SECTION}>
            {line.raw_name && (
              <ListRow title="Excel nomi" subtitle={<span className="font-mono">{line.raw_name}</span>} />
            )}
            {line.note && <ListRow title="Izoh" subtitle={line.note} />}
          </ListSection>
        )}

        {(canEdit || canDelete) && (
          <ListSection className={SHEET_SECTION}>
            {canEdit && <ListRow title="Tahrirlash" tone="primary" center onClick={onEdit} />}
            {canDelete && <ListRow title="Qatorni o'chirish" tone="danger" center onClick={onDelete} />}
          </ListSection>
        )}
      </ModalBody>
    </Modal>
  );
}

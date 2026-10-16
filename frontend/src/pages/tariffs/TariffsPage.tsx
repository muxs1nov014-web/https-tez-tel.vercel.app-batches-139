import { Fragment, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../api/client';
import {
  createTariff,
  deleteTariff,
  listTariffs,
  tariffKeys,
  updateTariff,
  type Tariff,
  type TariffIn,
} from '../../api/tariffs';
import { Can } from '../../components/Can';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, TableWrap } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { PencilIcon, PlusIcon, TrashIcon } from '../../components/ui/icons';
import { Checkbox, Field, Input, NumberInput } from '../../components/ui/Input';
import { ListRow, ListSection } from '../../components/ui/List';
import { Modal, ModalBody, ModalFooter } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { SearchField } from '../../components/ui/SearchField';
import { EmptyState, LoadingState, QueryView } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useCan } from '../../lib/auth';
import { todayISO } from '../../lib/dates';
import { fmtDate, fmtPct, fmtQty, fmtUsd, numToInput, parseInputNumber, toNum } from '../../lib/format';
import { useChannels, useSettings } from '../../lib/queries';
import { SwitchRow } from './FormRows';
import { SettingsCard } from './SettingsCard';

const SEARCH_PLACEHOLDER = 'Qidirish: 17 pro max…';

function tariffGroupKey(t: Tariff): string {
  return `${t.brand}|${t.model}|${t.storage}`.toLowerCase();
}

export function TariffsPage() {
  const query = useQuery({ queryKey: tariffKeys.all, queryFn: listTariffs });
  const settings = useSettings();
  const channels = useChannels();
  const can = useCan();
  const canWrite = can('catalog.write');
  const canDelete = can('tariffs.delete');

  const [search, setSearch] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [editing, setEditing] = useState<Tariff | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<Tariff | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const customsRate = toNum(settings.data?.customs_rate);
  const channelList = channels.data ?? [];

  const rows = useMemo(() => {
    const data = query.data ?? [];
    // The newest valid_from per (brand, model, storage) is the one in effect.
    const latest = new Map<string, string>();
    for (const t of data) {
      const k = tariffGroupKey(t);
      const cur = latest.get(k);
      if (!cur || t.valid_from > cur) latest.set(k, t.valid_from);
    }
    const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
    return data
      .map((t) => ({ tariff: t, current: latest.get(tariffGroupKey(t)) === t.valid_from }))
      .filter((r) => showHistory || r.current)
      .filter((r) => {
        const hay = `${r.tariff.brand} ${r.tariff.model} ${r.tariff.storage}`.toLowerCase();
        return tokens.every((tok) => hay.includes(tok));
      })
      .sort(
        (a, b) =>
          a.tariff.brand.localeCompare(b.tariff.brand) ||
          a.tariff.model.localeCompare(b.tariff.model, undefined, { numeric: true }) ||
          a.tariff.storage.localeCompare(b.tariff.storage, undefined, { numeric: true }) ||
          (a.tariff.valid_from < b.tariff.valid_from ? 1 : -1),
      );
  }, [query.data, search, showHistory]);

  const del = useMutation({
    mutationFn: (id: number) => deleteTariff(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tariffKeys.all });
      toast.success("Tarif o'chirildi");
      setToDelete(null);
    },
  });

  const emptyAll = (
    <EmptyState
      title="Tarif kiritilmagan"
      description="Tarif bo'lmasa, rastamojka avtomatik hisoblanmaydi va qo'lda kiritiladi."
    />
  );
  const emptySearch = <EmptyState title={`«${search}» bo'yicha tarif topilmadi`} />;
  // iPhone rows: tap edits (or, for delete-only roles, asks to delete).
  const rowAction = (t: Tariff): (() => void) | undefined =>
    canWrite ? () => setEditing(t) : canDelete ? () => setToDelete(t) : undefined;

  return (
    <div className="space-y-8 md:space-y-4">
      <PageHeader
        title="Bojxona tariflari"
        subtitle={`Rastamojka taxmini = bazaviy narx × ${fmtPct(customsRate || null)} × kanal koeffitsienti. Yangi narx kiritilsa, eski narx tarixda qoladi (amal qilish sanasi bo'yicha).`}
        actions={
          <Can do="catalog.write">
            <Button variant="primary" icon={<PlusIcon className="h-4 w-4" />} onClick={() => setEditing('new')}>
              Tarif qo'shish
            </Button>
          </Can>
        }
      />

      <SettingsCard />

      {/* iPhone: search, history switch, inset-grouped list. */}
      <div className="space-y-4 md:hidden">
        <SearchField value={search} onChange={setSearch} placeholder={SEARCH_PLACEHOLDER} />
        <ListSection>
          <SwitchRow label="Tarixni ko'rsatish" checked={showHistory} onChange={setShowHistory} />
        </ListSection>
        <QueryView query={query} isEmpty={(data) => data.length === 0} empty={emptyAll} loading={<LoadingState />}>
          {() =>
            rows.length === 0 ? (
              emptySearch
            ) : (
              <ListSection header="Bazaviy narxlar" footer={`${fmtQty(rows.length)} ta tarif`} className="pt-4">
                {rows.map(({ tariff: t, current }) => {
                  const action = rowAction(t);
                  return (
                    <ListRow
                      key={t.id}
                      title={
                        <span className={`inline-flex max-w-full items-center gap-1.5 ${current ? '' : 'text-slate-400'}`}>
                          <span className="truncate">
                            {t.model} {t.storage}
                          </span>
                          {!current && <Badge>eski</Badge>}
                        </span>
                      }
                      subtitle={
                        <>
                          <span className="block truncate">
                            {t.brand} · {fmtDate(t.valid_from)}
                          </span>
                          {channelList.length > 0 && (
                            <span className="block whitespace-normal">
                              Rastamojka:{' '}
                              {channelList.map((c, i) => (
                                <Fragment key={c.id}>
                                  {i > 0 && ' · '}
                                  <span className="whitespace-nowrap">
                                    {c.name}{' '}
                                    {fmtUsd(toNum(t.base_price_usd) * customsRate * toNum(c.customs_factor), { symbol: true })}
                                  </span>
                                </Fragment>
                              ))}
                            </span>
                          )}
                        </>
                      }
                      value={fmtUsd(t.base_price_usd, { symbol: true })}
                      valueStrong={current}
                      onClick={action}
                      chevron={Boolean(action)}
                    />
                  );
                })}
              </ListSection>
            )
          }
        </QueryView>
      </div>

      {/* iPad / Mac: the table. */}
      <Card
        className="hidden md:block"
        title="Bazaviy narxlar"
        actions={
          <>
            <Checkbox checked={showHistory} onChange={setShowHistory} label="Tarixni ko'rsatish" />
            <SearchField value={search} onChange={setSearch} placeholder={SEARCH_PLACEHOLDER} className="w-60" />
          </>
        }
      >
        <QueryView query={query} isEmpty={(data) => data.length === 0} empty={emptyAll}>
          {() =>
            rows.length === 0 ? (
              emptySearch
            ) : (
              <TableWrap>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Brend</th>
                      <th>Model</th>
                      <th>Xotira</th>
                      <th className="num">Bazaviy narx ($)</th>
                      {channelList.map((c) => (
                        <th key={c.id} className="num">
                          Rastamojka: {c.name}
                        </th>
                      ))}
                      <th>Amal qilish sanasi</th>
                      {(canWrite || canDelete) && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ tariff: t, current }) => (
                      <tr key={t.id} className={current ? '' : 'text-slate-400'}>
                        <td>{t.brand}</td>
                        <td className="font-medium">{t.model}</td>
                        <td>{t.storage}</td>
                        <td className="num font-medium">{fmtUsd(t.base_price_usd)}</td>
                        {channelList.map((c) => (
                          <td key={c.id} className="num">
                            {fmtUsd(toNum(t.base_price_usd) * customsRate * toNum(c.customs_factor))}
                          </td>
                        ))}
                        <td className="whitespace-nowrap">
                          {fmtDate(t.valid_from)} {!current && <Badge>eski</Badge>}
                        </td>
                        {(canWrite || canDelete) && (
                          <td className="w-16 whitespace-nowrap text-right">
                            {canWrite && (
                              <IconButton label="Tahrirlash" onClick={() => setEditing(t)}>
                                <PencilIcon className="h-4 w-4" />
                              </IconButton>
                            )}
                            {canDelete && (
                              <IconButton label="O'chirish" tone="danger" onClick={() => setToDelete(t)}>
                                <TrashIcon className="h-4 w-4" />
                              </IconButton>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5 + channelList.length + (canWrite || canDelete ? 1 : 0)}>
                        {fmtQty(rows.length)} ta tarif
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </TableWrap>
            )
          }
        </QueryView>
      </Card>

      {editing && (
        <TariffModal
          tariff={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDelete={
            canDelete && editing !== 'new'
              ? () => {
                  setEditing(null);
                  setToDelete(editing);
                }
              : undefined
          }
        />
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title="Tarifni o'chirish"
        message={
          toDelete &&
          `${toDelete.brand} ${toDelete.model} ${toDelete.storage} (${fmtDate(toDelete.valid_from)}, ${fmtUsd(toDelete.base_price_usd, { symbol: true })}) o'chirilsinmi? Mavjud partiyalar o'zgarmaydi.`
        }
        loading={del.isPending}
        error={del.isError ? errorMessage(del.error) : null}
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
        onClose={() => {
          setToDelete(null);
          del.reset();
        }}
      />
    </div>
  );
}

interface TariffModalProps {
  tariff: Tariff | null;
  onClose: () => void;
  /** iPhone has no row icons, so deleting is offered here (hidden from md up, where the table has it). */
  onDelete?: () => void;
}

function TariffModal({ tariff, onClose, onDelete }: TariffModalProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [brand, setBrand] = useState(tariff?.brand ?? 'Apple');
  const [model, setModel] = useState(tariff?.model ?? '');
  const [storage, setStorage] = useState(tariff?.storage ?? '');
  const [base, setBase] = useState(tariff ? numToInput(tariff.base_price_usd) : '');
  const [validFrom, setValidFrom] = useState(tariff?.valid_from ?? todayISO());
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: TariffIn) => (tariff ? updateTariff(tariff.id, body) : createTariff(body)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tariffKeys.all });
      toast.success('Tarif saqlandi');
      onClose();
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const price = parseInputNumber(base);
    if (!brand.trim() || !model.trim()) {
      setError('Brend va model majburiy');
      return;
    }
    if (price === undefined || price < 0) {
      setError("Bazaviy narxni to'g'ri kiriting");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) {
      setError('Amal qilish sanasini kiriting');
      return;
    }
    setError(null);
    mutation.mutate({
      brand: brand.trim(),
      model: model.trim(),
      storage: storage.trim(),
      base_price_usd: price,
      valid_from: validFrom,
    });
  };

  return (
    <Modal open title={tariff ? 'Tarifni tahrirlash' : "Tarif qo'shish"} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate>
        <ModalBody className="space-y-3">
          {!tariff && (
            <Alert tone="info">
              Narx o'zgarganda eskisini tahrirlamang — yangi sana bilan yangi tarif qo'shing. Shunda eski partiyalar eski
              narx bo'yicha qoladi.
            </Alert>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Brend" htmlFor="t-brand" required>
              <Input id="t-brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
            </Field>
            <Field label="Model" htmlFor="t-model" required hint="Katalogdagi model bilan bir xil">
              <Input id="t-model" value={model} onChange={(e) => setModel(e.target.value)} autoFocus={!tariff} />
            </Field>
            <Field label="Xotira" htmlFor="t-storage" hint="Masalan: 256GB">
              <Input id="t-storage" value={storage} onChange={(e) => setStorage(e.target.value)} />
            </Field>
            <Field label="Bazaviy narx ($)" htmlFor="t-base" required>
              <NumberInput id="t-base" value={base} onChange={(e) => setBase(e.target.value)} />
            </Field>
            <Field label="Amal qilish sanasi" htmlFor="t-from" required>
              <Input id="t-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </Field>
          </div>
          {(error || mutation.isError) && <Alert tone="danger">{error ?? errorMessage(mutation.error)}</Alert>}
        </ModalBody>
        <ModalFooter>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={mutation.isPending}
              className="mr-auto inline-flex h-9 items-center rounded-full px-3 text-[15px] font-medium text-danger-600 transition-colors active:bg-danger-50 disabled:opacity-40 md:hidden"
            >
              O'chirish
            </button>
          )}
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

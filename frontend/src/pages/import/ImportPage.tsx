import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { importPurchases, type ImportResult } from '../../api/imports';
import { productKeys } from '../../api/products';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, TableWrap } from '../../components/ui/Card';
import { TableIcon, UploadIcon } from '../../components/ui/icons';
import { ListRow, ListSection } from '../../components/ui/List';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState } from '../../components/ui/States';
import { StatCard } from '../../components/ui/StatCard';
import { useToast } from '../../components/ui/Toast';
import { fmtDate, fmtQty } from '../../lib/format';
import { invalidateLedger } from '../../lib/queries';
import { TINTS } from '../../lib/tints';

const FILE_INPUT_ID = 'import-file';
/** iPhone: large full-width capsules; sm+: the regular inline buttons. */
const PHONE_BUTTON = 'max-sm:h-12 max-sm:w-full max-sm:text-[17px]';

function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function summarize(result: ImportResult) {
  const fresh = result.batches.filter((b) => b.status === 'new');
  return {
    newBatches: fresh.length,
    existing: result.batches.length - fresh.length,
    lines: fresh.reduce((s, b) => s + b.lines, 0),
    qty: fresh.reduce((s, b) => s + b.qty, 0),
  };
}

export function ImportPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [committed, setCommitted] = useState<ImportResult | null>(null);
  const [showAllWarnings, setShowAllWarnings] = useState(false);

  const dryRun = useMutation({
    mutationFn: (f: File) => importPurchases(f, true),
    onSuccess: (res) => {
      setPreview(res);
      setCommitted(null);
    },
  });

  const commit = useMutation({
    mutationFn: (f: File) => importPurchases(f, false),
    onSuccess: (res) => {
      setCommitted(res);
      void invalidateLedger(queryClient);
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
      toast.success(`Import tugadi: ${fmtQty(res.created_batches)} ta partiya, ${fmtQty(res.created_products)} ta mahsulot`);
    },
  });

  const reset = () => {
    setFile(null);
    setPreview(null);
    setCommitted(null);
    dryRun.reset();
    commit.reset();
    if (inputRef.current) inputRef.current.value = '';
  };

  const s = preview ? summarize(preview) : null;
  const warnings = preview?.warnings ?? [];
  const visibleWarnings = showAllWarnings ? warnings : warnings.slice(0, 10);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Excel import"
        subtitle="«Malumot kiritish» varag'i formatidagi fayl. Avval tekshiriladi (hech narsa yozilmaydi), keyin tasdiqlansa import qilinadi. Bazada bor sanalar o'tkazib yuboriladi — qayta yuklash xavfsiz."
      />

      {/* iPhone: the file is a tappable list row (a label for the input below), then full-width actions. */}
      <div className="space-y-3 md:hidden">
        <ListSection header="1. Faylni tanlang">
          <li>
            <label
              htmlFor={FILE_INPUT_ID}
              className="flex w-full cursor-pointer items-center gap-3 pl-4 transition-colors active:bg-slate-200/70"
            >
              <span
                className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] bg-gradient-to-b text-white shadow-glyph [&>svg]:stroke-[2] ${TINTS.green}`}
              >
                <TableIcon className="h-[17px] w-[17px]" />
              </span>
              <span className="flex min-h-[56px] min-w-0 flex-1 flex-col justify-center py-[10px] pr-4">
                <span
                  className={`truncate text-[17px] leading-[22px] tracking-[-0.025em] ${file ? 'text-slate-900' : 'text-primary-600'}`}
                >
                  {file ? file.name : 'Faylni tanlang'}
                </span>
                <span className="mt-0.5 truncate text-[13px] leading-[18px] text-slate-500">
                  {file ? fileSize(file.size) : '.xlsx · .xlsm'}
                </span>
              </span>
            </label>
          </li>
        </ListSection>
        <div className="flex flex-col gap-2.5">
          <Button
            variant="primary"
            icon={<UploadIcon className="h-4 w-4" />}
            disabled={!file || commit.isPending}
            loading={dryRun.isPending}
            onClick={() => file && dryRun.mutate(file)}
            className={PHONE_BUTTON}
          >
            Tekshirish
          </Button>
          {(preview || file) && (
            <Button onClick={reset} disabled={dryRun.isPending || commit.isPending} className={PHONE_BUTTON}>
              Tozalash
            </Button>
          )}
        </div>
        {dryRun.isPending && (
          <p className="px-4 text-[13px] text-slate-500">Fayl o'qilmoqda… Katta fayllar bir necha soniya olishi mumkin.</p>
        )}
        {dryRun.isError && (
          <Alert tone="danger" title="Faylni tekshirib bo'lmadi">
            {errorMessage(dryRun.error)}
          </Alert>
        )}
      </div>

      <Card title="1. Faylni tanlang" padded className="hidden md:block">
        <div className="flex flex-wrap items-center gap-3">
          <input
            id={FILE_INPUT_ID}
            ref={inputRef}
            type="file"
            accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setCommitted(null);
              dryRun.reset();
              commit.reset();
            }}
            className="block text-[13px] text-slate-600 file:mr-3 file:rounded-full file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-primary-700 hover:file:bg-primary-100"
          />
          <Button
            variant="primary"
            icon={<UploadIcon className="h-4 w-4" />}
            disabled={!file || commit.isPending}
            loading={dryRun.isPending}
            onClick={() => file && dryRun.mutate(file)}
          >
            Tekshirish
          </Button>
          {(preview || file) && (
            <Button variant="ghost" onClick={reset} disabled={dryRun.isPending || commit.isPending}>
              Tozalash
            </Button>
          )}
        </div>
        {dryRun.isPending && (
          <p className="mt-2 text-xs text-slate-500">Fayl o'qilmoqda… Katta fayllar bir necha soniya olishi mumkin.</p>
        )}
        {dryRun.isError && (
          <Alert tone="danger" className="mt-3" title="Faylni tekshirib bo'lmadi">
            {errorMessage(dryRun.error)}
          </Alert>
        )}
      </Card>

      {preview && s && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatCard label="Yangi partiyalar" value={fmtQty(s.newBatches)} />
            <StatCard label="Bazada bor (o'tkaziladi)" value={fmtQty(s.existing)} />
            <StatCard label="Yangi qatorlar" value={fmtQty(s.lines)} />
            <StatCard label="Yangi dona" value={fmtQty(s.qty)} />
            <div className="col-span-2 md:col-span-1">
              <StatCard label="Yangi mahsulotlar" value={fmtQty(preview.new_products.length)} />
            </div>
          </div>

          {committed ? (
            <Alert tone="success" title="Import yakunlandi">
              {fmtQty(committed.created_batches)} ta partiya va {fmtQty(committed.created_products)} ta mahsulot yaratildi.{' '}
              <Link to="/batches" className="font-medium underline">
                Partiyalarni ko'rish
              </Link>
              . Endi Ombor sahifasida boshlang'ich qoldiqni kiriting.
            </Alert>
          ) : (
            <Card title="2. Tasdiqlash" padded>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[13px] text-slate-600">
                  {s.newBatches > 0
                    ? `${fmtQty(s.newBatches)} ta yangi partiya (${fmtQty(s.qty)} dona) va ${fmtQty(preview.new_products.length)} ta yangi mahsulot yoziladi.`
                    : "Yangi partiya yo'q — fayldagi barcha sanalar bazada bor."}
                </p>
                <Button
                  variant="primary"
                  disabled={!file || s.newBatches === 0}
                  loading={commit.isPending}
                  onClick={() => file && commit.mutate(file)}
                  className={PHONE_BUTTON}
                >
                  Tasdiqlash va import qilish
                </Button>
              </div>
              {commit.isError && (
                <Alert tone="danger" className="mt-3" title="Import bajarilmadi">
                  {errorMessage(commit.error)}
                </Alert>
              )}
            </Card>
          )}

          {warnings.length > 0 && (
            <Alert tone="warning" title={`Ogohlantirishlar (${fmtQty(warnings.length)})`}>
              <ul className="list-disc space-y-0.5 pl-4">
                {visibleWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              {warnings.length > 10 && (
                <button
                  type="button"
                  className="mt-1 text-xs font-medium underline"
                  onClick={() => setShowAllWarnings((v) => !v)}
                >
                  {showAllWarnings ? 'Qisqartirish' : `Yana ${fmtQty(warnings.length - 10)} tasini ko'rsatish`}
                </button>
              )}
            </Alert>
          )}

          {/* iPhone: both previews as inset-grouped lists. */}
          <div className="space-y-8 pt-4 md:hidden">
            <ListSection
              header={`Yangi mahsulotlar (${fmtQty(preview.new_products.length)})`}
              footer="Katalogda yo'q nomlar — avtomatik yaratiladi. Noto'g'ri ajratilgan bo'lsa, importdan keyin Katalogda tuzating."
            >
              {preview.new_products.length === 0 ? (
                <li>
                  <EmptyState title="Barcha nomlar katalogda bor" />
                </li>
              ) : (
                preview.new_products.map((p, i) => (
                  <ListRow key={`${p.raw_name}-${i}`} title={p.name} subtitle={p.raw_name} />
                ))
              )}
            </ListSection>
            <ListSection header={`Partiyalar (${fmtQty(preview.batches.length)})`}>
              {preview.batches.length === 0 ? (
                <li>
                  <EmptyState title="Faylda sanali qator topilmadi" description="Varaq nomi va ustunlar tartibini tekshiring." />
                </li>
              ) : (
                preview.batches.map((b) => (
                  <ListRow
                    key={b.batch_date}
                    title={<span className={b.status === 'exists' ? 'text-slate-400' : ''}>{fmtDate(b.batch_date)}</span>}
                    subtitle={`${fmtQty(b.lines)} qator`}
                    value={`${fmtQty(b.qty)} dona`}
                    valueSub={
                      b.status === 'new' ? <span className="text-success-700">Yangi</span> : 'Bazada bor'
                    }
                  />
                ))
              )}
            </ListSection>
          </div>

          <div className="hidden gap-4 md:grid xl:grid-cols-2">
            <Card title={`Yangi mahsulotlar (${fmtQty(preview.new_products.length)})`} subtitle="Katalogda yo'q nomlar — avtomatik yaratiladi. Noto'g'ri ajratilgan bo'lsa, importdan keyin Katalogda tuzating.">
              {preview.new_products.length === 0 ? (
                <EmptyState title="Barcha nomlar katalogda bor" />
              ) : (
                <TableWrap className="max-h-[28rem] overflow-y-auto">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Excel'dagi nom</th>
                        <th>Katalogdagi nom</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.new_products.map((p, i) => (
                        <tr key={`${p.raw_name}-${i}`}>
                          <td className="font-mono text-xs">{p.raw_name}</td>
                          <td className="font-medium">{p.name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </Card>

            <Card title={`Partiyalar (${fmtQty(preview.batches.length)})`}>
              {preview.batches.length === 0 ? (
                <EmptyState title="Faylda sanali qator topilmadi" description="Varaq nomi va ustunlar tartibini tekshiring." />
              ) : (
                <TableWrap className="max-h-[28rem] overflow-y-auto">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Sana</th>
                        <th className="num">Qatorlar</th>
                        <th className="num">Dona</th>
                        <th>Holati</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.batches.map((b) => (
                        <tr key={b.batch_date} className={b.status === 'exists' ? 'text-slate-400' : ''}>
                          <td>{fmtDate(b.batch_date)}</td>
                          <td className="num">{fmtQty(b.lines)}</td>
                          <td className="num">{fmtQty(b.qty)}</td>
                          <td>
                            {b.status === 'new' ? (
                              <Badge tone="success">Yangi</Badge>
                            ) : (
                              <Badge>Bazada bor</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

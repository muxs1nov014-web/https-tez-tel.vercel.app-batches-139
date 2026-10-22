import type { BatchDetail } from '../../api/batches';
import { fmtDate, fmtQty, fmtUsd, fmtUsdUp, toNum } from '../../lib/format';
import { modelCostNote, modelCostRows } from './ModelCostCard';

/**
 * The "Model bo'yicha tannarx" card drawn as a PNG for Telegram (SPEC §17): the batch, one row per model
 * (`xarajat +…` · `qty dona ×` · unit cost, whole dollars rounded up) and the total. Drawn on a canvas in the
 * browser, so it looks like the card in the panel without a server-side renderer.
 */
const WIDTH = 640;
const PAD = 22;
const ROW_H = 54;
const SCALE = 2;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const C = {
  bg: '#000000',
  panel: '#1c1c1e',
  line: '#2c2c2e',
  pill: '#2c2c2e',
  text: '#ffffff',
  muted: '#8e8e93',
};

/** Whole dollars, cents rounded up: the same value fmtUsdUp shows. */
function dollarsUp(value: number): number {
  return Math.ceil(Math.round(toNum(value) * 100 + 1e-6) / 100);
}

function font(size: number, weight = 400): string {
  return `${weight} ${size}px ${FONT}`;
}

function ellipsis(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    const next = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(next).width > max) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawCostPicture(batch: BatchDetail): Promise<Blob> {
  const rows = modelCostRows(batch);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error("Brauzer rasm chiza olmadi"));

  // the note may wrap: measure it before sizing the canvas
  ctx.font = font(14);
  const note = wrap(ctx, modelCostNote(batch), WIDTH - PAD * 2);
  const head = 22 + 34 + note.length * 19 + 14;
  const height = PAD + head + rows.length * ROW_H + 16 + 34 + PAD;

  canvas.width = WIDTH * SCALE;
  canvas.height = height * SCALE;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.textBaseline = 'alphabetic';

  let y = PAD + 14;
  ctx.font = font(14, 500);
  ctx.fillStyle = C.muted;
  ctx.fillText(`📦 Partiya · ${fmtDate(batch.batch_date)}${batch.code ? ` · ${batch.code}` : ''}`, PAD, y);
  y += 32;
  ctx.font = font(22, 700);
  ctx.fillStyle = C.text;
  ctx.fillText("Model bo'yicha tannarx", PAD, y);
  ctx.font = font(14);
  ctx.fillStyle = C.muted;
  for (const line of note) {
    y += 19;
    ctx.fillText(line, PAD, y);
  }
  y += 14;

  const panelX = PAD;
  const panelW = WIDTH - PAD * 2;
  ctx.fillStyle = C.panel;
  roundRect(ctx, panelX, y, panelW, rows.length * ROW_H, 16);
  ctx.fill();

  rows.forEach((m, i) => {
    const top = y + i * ROW_H;
    const base = top + ROW_H / 2 + 6;
    if (i > 0) {
      ctx.fillStyle = C.line;
      ctx.fillRect(panelX + 16, top, panelW - 32, 1);
    }
    // right side first, so the name gets what is left
    let right = panelX + panelW - 16;
    ctx.textAlign = 'right';
    ctx.font = font(19, 700);
    ctx.fillStyle = C.text;
    const unit = fmtUsdUp(m.unit);
    ctx.fillText(unit, right, base);
    right -= ctx.measureText(unit).width + 6;
    ctx.font = font(19);
    ctx.fillStyle = C.muted;
    const qty = `${fmtQty(m.qty)} dona ×`;
    ctx.fillText(qty, right, base);
    right -= ctx.measureText(qty).width + 12;
    ctx.font = font(12);
    const pill = `xarajat +${fmtUsd(m.overhead, { symbol: true })}`;
    const pillW = ctx.measureText(pill).width + 14;
    ctx.fillStyle = C.pill;
    roundRect(ctx, right - pillW, base - 15, pillW, 21, 6);
    ctx.fill();
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'center';
    ctx.fillText(pill, right - pillW / 2, base);
    right -= pillW + 14;

    ctx.textAlign = 'left';
    ctx.font = font(16, 600);
    ctx.fillStyle = C.text;
    ctx.fillText(ellipsis(ctx, m.name, right - panelX - 16), panelX + 16, base);
  });
  y += rows.length * ROW_H + 16;

  const qty = rows.reduce((s, m) => s + m.qty, 0);
  const total = rows.reduce((s, m) => s + m.qty * dollarsUp(m.unit), 0);
  ctx.textAlign = 'left';
  ctx.font = font(16);
  ctx.fillStyle = C.muted;
  ctx.fillText('Jami', PAD + 16, y + 22);
  ctx.textAlign = 'right';
  ctx.font = font(18, 700);
  ctx.fillStyle = C.text;
  ctx.fillText(`${fmtQty(qty)} dona · ${fmtUsd(total, { symbol: true, decimals: 0 })}`, WIDTH - PAD - 16, y + 22);

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Brauzer rasm chiza olmadi"))), 'image/png'),
  );
}

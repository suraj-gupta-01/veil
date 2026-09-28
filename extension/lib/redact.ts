import type { CompositeRequest, CompositeResult } from './messages';

const PAD = 3;
const MARK_BG = '#1B6F61';

// PR-8: mask widths snap to per-class buckets, in multiples of the mask height so they scale with font size,
// so a mask does not reveal how long the value is. Region masks (faces, codes, images) keep their shape.
const FIXED_FORMAT = ['AADHAAR', 'PAN', 'PASSPORT', 'VOTER_ID', 'CARD', 'ACCOUNT', 'IFSC', 'PHONE', 'DOB'];
const REGION = ['FACE', 'SIGNATURE', 'QR', 'IMAGE'];
const BUCKETS: Record<string, number[]> = { SECRET: [6], ...Object.fromEntries(FIXED_FORMAT.map((c) => [c, [6, 8, 11]])) };
// Geometric steps about 35% apart: coarse enough to hide length, fine enough not to cover much neighbouring text.
const VARIABLE = [3, 4, 5.5, 7.5, 10, 14, 19, 26, 35];

export function maskWidth(label: string, w: number, h: number): number {
  const cls = /^⟦([A-Z_]+?)_\d+⟧$/.exec(label)?.[1] ?? label;
  if (REGION.includes(cls) || h <= 0) return w;
  const steps = BUCKETS[cls] ?? VARIABLE;
  const r = w / h;
  const max = steps[steps.length - 1];
  return (steps.find((s) => s >= r) ?? Math.ceil(r / max) * max) * h;
}

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function toBlob(c: OffscreenCanvas | HTMLCanvasElement): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type: 'image/webp', quality: 0.8 });
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/webp', 0.8));
}

function base64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function composite(req: CompositeRequest): Promise<CompositeResult> {
  const bmp = await createImageBitmap(await (await fetch(req.image)).blob());
  const s = Math.min(1, req.maxSide / Math.max(bmp.width, bmp.height));
  const W = Math.round(bmp.width * s);
  const H = Math.round(bmp.height * s);
  const k = (bmp.width / req.viewport[0]) * s;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d') as Ctx;
  ctx.drawImage(bmp, 0, 0, W, H);
  bmp.close?.();

  const boxes = req.masks
    .map((m) => {
      const w = m.bbox[2] - m.bbox[0] + 2 * PAD;
      const h = m.bbox[3] - m.bbox[1] + 2 * PAD;
      return {
        x: Math.floor((m.bbox[0] - PAD) * k),
        y: Math.floor((m.bbox[1] - PAD) * k),
        w: Math.ceil((m.field ? w : maskWidth(m.label, w, h)) * k),
        h: Math.ceil(h * k),
        label: m.label.replace(/[⟦⟧]/g, ''),
      };
    })
    .filter((b) => b.w > 0 && b.h > 0 && b.x < W && b.y < H && b.x + b.w > 0 && b.y + b.h > 0);

  ctx.fillStyle = '#000';
  for (const b of boxes) ctx.fillRect(b.x, b.y, b.w, b.h);

  let failed = 0;
  for (const b of boxes) {
    const px = Math.min(W - 1, Math.max(0, b.x + 1));
    const py = Math.min(H - 1, Math.max(0, b.y + 1));
    const d = ctx.getImageData(px, py, 1, 1).data;
    if (d[0] > 16 || d[1] > 16 || d[2] > 16) failed++;
  }

  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  for (const b of boxes) {
    const fs = Math.min(b.h * 0.62, 13 * Math.max(k, 1));
    if (fs < 8) continue;
    ctx.font = `${fs}px ui-monospace, Menlo, Consolas, monospace`;
    if (ctx.measureText(b.label).width <= b.w - 6) ctx.fillText(b.label, b.x + 3, b.y + b.h / 2);
  }

  const tagH = Math.max(12, Math.round(13 * k));
  ctx.font = `600 ${Math.round(tagH * 0.72)}px system-ui, sans-serif`;
  for (const m of req.marks) {
    const label = String(m.id);
    const tw = Math.ceil(ctx.measureText(label).width) + 8;
    const x = Math.max(0, Math.round(m.bbox[0] * k) - 2);
    const top = Math.round(m.bbox[1] * k);
    const y = top - tagH >= 0 ? top - tagH : top;
    ctx.fillStyle = MARK_BG;
    ctx.fillRect(x, y, tw, tagH);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 4, y + tagH / 2 + 1);
  }

  const blob = await toBlob(canvas);
  const buf = await blob.arrayBuffer();
  return {
    image: `data:${blob.type || 'image/webp'};base64,${base64(buf)}`,
    width: W,
    height: H,
    bytes: buf.byteLength,
    integrity: failed === 0,
    failed,
  };
}

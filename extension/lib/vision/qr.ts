import type { BBox } from '../vrs';
import type { Img } from './image';

// QR codes are found by their three finder patterns: dark-light-dark-light-dark runs in a 1:1:3:1:1 ratio,
// stacked over several rows, placed at three corners of a square.
// ponytail: fixed luminance threshold and QR only; barcodes and low-contrast codes wait for the Phase 3 detector.

interface Center { x: number; y: number; m: number; rows: number }

function ratioOk(c: number[]): number {
  const total = c.reduce((a, b) => a + b, 0);
  if (total < 7) return 0;
  const m = total / 7;
  const tol = m * 0.6;
  const ok = Math.abs(c[0] - m) < tol && Math.abs(c[1] - m) < tol && Math.abs(c[2] - 3 * m) < 3 * tol && Math.abs(c[3] - m) < tol && Math.abs(c[4] - m) < tol;
  return ok ? m : 0;
}

export function findCodes(img: Img): BBox[] {
  const { width: W, height: H, data } = img;
  const dark = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) dark[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2] < 128 ? 1 : 0;

  const centers: Center[] = [];
  for (let y = 0; y < H; y++) {
    const runs: { d: number; x: number; n: number }[] = [];
    for (let x = 0; x < W; x++) {
      const d = dark[y * W + x];
      const last = runs[runs.length - 1];
      if (last && last.d === d) last.n++;
      else runs.push({ d, x, n: 1 });
    }
    for (let i = 0; i + 4 < runs.length; i++) {
      if (!runs[i].d) continue;
      const m = ratioOk(runs.slice(i, i + 5).map((r) => r.n));
      if (!m) continue;
      const x = runs[i + 2].x + runs[i + 2].n / 2;
      const c = centers.find((q) => Math.abs(q.x - x) < q.m * 1.5 && Math.abs(q.y - y) < q.m * 3 && q.m / m < 1.5 && m / q.m < 1.5);
      if (c) { c.y = (c.y * c.rows + y) / (c.rows + 1); c.x = (c.x * c.rows + x) / (c.rows + 1); c.m = (c.m * c.rows + m) / (c.rows + 1); c.rows++; }
      else centers.push({ x, y, m, rows: 1 });
    }
  }

  // The finder center is three modules tall, so a real one shows up on about 3m rows.
  const real = centers.filter((c) => c.rows >= Math.max(2, c.m * 1.5));
  const out: BBox[] = [];
  const used = new Set<Center>();
  const d = (a: Center, b: Center) => Math.hypot(a.x - b.x, a.y - b.y);
  for (let i = 0; i < real.length; i++) for (let j = i + 1; j < real.length; j++) for (let k = j + 1; k < real.length; k++) {
    const t = [real[i], real[j], real[k]];
    if (t.some((c) => used.has(c))) continue;
    const ms = t.map((c) => c.m);
    if (Math.max(...ms) / Math.min(...ms) > 1.5) continue;
    // Sides sorted so the hypotenuse is last; the right-angle corner is the vertex opposite it.
    const sides = ([[0, 1, 2], [1, 2, 0], [0, 2, 1]] as const).map(([p, q, r]) => ({ len: d(t[p], t[q]), p: t[p], q: t[q], corner: t[r] })).sort((u, v) => u.len - v.len);
    const [a, b, c] = sides.map((s) => s.len);
    if (a < 7 * Math.min(...ms) || b / a > 1.25 || Math.abs(c / (a * Math.SQRT2) - 1) > 0.15) continue;
    const pad = 4.5 * Math.max(...ms);
    // The fourth corner has no finder pattern; complete the square.
    const { p, q, corner } = sides[2];
    const fourth = { x: p.x + q.x - corner.x, y: p.y + q.y - corner.y };
    const xs = [...t.map((p) => p.x), fourth.x];
    const ys = [...t.map((p) => p.y), fourth.y];
    const box: BBox = [
      Math.max(0, Math.floor(Math.min(...xs) - pad)),
      Math.max(0, Math.floor(Math.min(...ys) - pad)),
      Math.min(W, Math.ceil(Math.max(...xs) + pad)),
      Math.min(H, Math.ceil(Math.max(...ys) + pad)),
    ];
    // Stray 1:1:3:1:1 runs inside a code can form a second triangle; one code per area is enough.
    if (out.some((o) => o[0] < box[2] && box[0] < o[2] && o[1] < box[3] && box[1] < o[3])) continue;
    out.push(box);
    t.forEach((p) => used.add(p));
  }
  return out;
}

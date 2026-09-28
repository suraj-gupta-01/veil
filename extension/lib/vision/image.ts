import type { BBox } from '../vrs';

/** RGBA pixels, the same layout as ImageData. */
export interface Img { data: Uint8ClampedArray | Uint8Array; width: number; height: number }

export function crop(img: Img, [x0, y0, x1, y1]: BBox): Img {
  const w = x1 - x0;
  const h = y1 - y0;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) out.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x1) * 4), y * w * 4);
  return { data: out, width: w, height: h };
}

export function resize(img: Img, w: number, h: number): Img {
  if (w === img.width && h === img.height) return img;
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = img.width / w;
  const sy = img.height / h;
  const src = img.data;
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, (y + 0.5) * sy - 0.5);
    const y0 = Math.min(img.height - 1, Math.floor(fy));
    const y1 = Math.min(img.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, (x + 0.5) * sx - 0.5);
      const x0 = Math.min(img.width - 1, Math.floor(fx));
      const x1 = Math.min(img.width - 1, x0 + 1);
      const tx = fx - x0;
      const a = (y0 * img.width + x0) * 4, b = (y0 * img.width + x1) * 4;
      const c = (y1 * img.width + x0) * 4, d = (y1 * img.width + x1) * 4;
      const o = (y * w + x) * 4;
      for (let ch = 0; ch < 4; ch++) {
        const top = src[a + ch] + (src[b + ch] - src[a + ch]) * tx;
        const bot = src[c + ch] + (src[d + ch] - src[c + ch]) * tx;
        out[o + ch] = top + (bot - top) * ty;
      }
    }
  }
  return { data: out, width: w, height: h };
}

export function iou(a: BBox, b: BBox): number {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter);
}

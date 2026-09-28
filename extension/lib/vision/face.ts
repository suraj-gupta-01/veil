import * as ort from 'onnxruntime-web';
import type { BBox } from '../vrs';
import { iou, resize, type Img } from './image';

// YuNet (OpenCV zoo, 2023mar): fixed 640x640 BGR input in 0..255, anchor-free heads at strides 8/16/32.
const SIZE = 640;
const STRIDES = [8, 16, 32];
const SCORE = 0.6;
const NMS = 0.3;

export async function detectFaces(session: ort.InferenceSession, img: Img): Promise<BBox[]> {
  const k = SIZE / Math.max(img.width, img.height);
  const small = resize(img, Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)));
  const plane = SIZE * SIZE;
  const x = new Float32Array(3 * plane);
  for (let y = 0; y < small.height; y++) {
    for (let c = 0; c < small.width; c++) {
      const i = (y * small.width + c) * 4;
      const o = y * SIZE + c;
      x[o] = small.data[i + 2];
      x[plane + o] = small.data[i + 1];
      x[2 * plane + o] = small.data[i];
    }
  }
  const out = await session.run({ input: new ort.Tensor('float32', x, [1, 3, SIZE, SIZE]) });

  const found: { box: BBox; score: number }[] = [];
  for (const st of STRIDES) {
    const n = SIZE / st;
    const cls = out[`cls_${st}`].data as Float32Array;
    const obj = out[`obj_${st}`].data as Float32Array;
    const bb = out[`bbox_${st}`].data as Float32Array;
    for (let i = 0; i < n * n; i++) {
      const score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])));
      if (score < SCORE) continue;
      const cx = ((i % n) + bb[i * 4]) * st;
      const cy = (Math.floor(i / n) + bb[i * 4 + 1]) * st;
      const w = Math.exp(bb[i * 4 + 2]) * st;
      const h = Math.exp(bb[i * 4 + 3]) * st;
      found.push({ box: [(cx - w / 2) / k, (cy - h / 2) / k, (cx + w / 2) / k, (cy + h / 2) / k], score });
    }
  }

  const kept: typeof found = [];
  for (const f of found.sort((a, b) => b.score - a.score)) if (kept.every((q) => iou(q.box, f.box) < NMS)) kept.push(f);
  // YuNet boxes hug the inner face; widen by 20% so hair line and chin are covered too.
  return kept.map(({ box: [x0, y0, x1, y1] }) => {
    const dx = (x1 - x0) * 0.2;
    const dy = (y1 - y0) * 0.2;
    return [
      Math.max(0, Math.floor(x0 - dx)),
      Math.max(0, Math.floor(y0 - dy)),
      Math.min(img.width, Math.ceil(x1 + dx)),
      Math.min(img.height, Math.ceil(y1 + dy)),
    ] as BBox;
  });
}

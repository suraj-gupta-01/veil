import * as ort from 'onnxruntime-web';
import type { BBox } from '../vrs';
import { crop, resize, type Img } from './image';

// PP-OCRv4 mobile: DB text detection plus CTC recognition. RGB input read screen text more accurately than BGR in our tests.

export interface OcrLine {
  text: string;
  bbox: BBox;
  /** Horizontal extent of each character of `text`, in the same pixel space as bbox. */
  chars: [number, number][];
}

const MAX_SIDE = 960;
const THRESH = 0.3;
const BOX_THRESH = 0.6;
const UNCLIP = 1.5;
const REC_H = 48;
const REC_MAX_W = 1280;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** The recognizer's character list lives in the ONNX metadata_props under "character". */
export function keysFrom(model: Uint8Array): string[] {
  let p = 0;
  const varint = (buf: Uint8Array) => {
    let v = 0, mul = 1, b: number;
    do { b = buf[p++]; v += (b & 0x7f) * mul; mul *= 128; } while (b & 0x80);
    return v;
  };
  while (p < model.length) {
    const tag = varint(model);
    const wire = tag % 8;
    if (wire === 0) { varint(model); continue; }
    if (wire === 1) { p += 8; continue; }
    if (wire === 5) { p += 4; continue; }
    if (wire !== 2) throw new Error('Unsupported ONNX wire type');
    const len = varint(model);
    const end = p + len;
    if (Math.floor(tag / 8) === 14) {
      const e: Record<number, string> = {};
      while (p < end) {
        const t = varint(model);
        const l = varint(model);
        e[Math.floor(t / 8)] = new TextDecoder().decode(model.subarray(p, p + l));
        p += l;
      }
      if (e[1] === 'character') return e[2].split('\n');
    }
    p = end;
  }
  throw new Error('No character list in the OCR model');
}

export async function detectText(session: ort.InferenceSession, img: Img): Promise<BBox[]> {
  const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const small = resize(img, Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)));
  const W = Math.ceil(small.width / 32) * 32;
  const H = Math.ceil(small.height / 32) * 32;
  const plane = W * H;
  const x = new Float32Array(3 * plane);
  for (let y = 0; y < small.height; y++) {
    for (let c = 0; c < small.width; c++) {
      const i = (y * small.width + c) * 4;
      const o = y * W + c;
      for (let ch = 0; ch < 3; ch++) x[ch * plane + o] = (small.data[i + ch] / 255 - MEAN[ch]) / STD[ch];
    }
  }
  const out = await session.run({ x: new ort.Tensor('float32', x, [1, 3, H, W]) });
  const prob = Object.values(out)[0].data as Float32Array;

  const label = new Int32Array(plane);
  const stack = new Int32Array(plane);
  const boxes: BBox[] = [];
  let next = 0;
  for (let s = 0; s < plane; s++) {
    if (label[s] || prob[s] <= THRESH) continue;
    label[s] = ++next;
    let top = 0, x0 = W, y0 = H, x1 = 0, y1 = 0, sum = 0, n = 0;
    stack[top++] = s;
    while (top) {
      const i = stack[--top];
      const cx = i % W;
      const cy = (i - cx) / W;
      if (cx < x0) x0 = cx;
      if (cx > x1) x1 = cx;
      if (cy < y0) y0 = cy;
      if (cy > y1) y1 = cy;
      sum += prob[i];
      n++;
      for (const j of [cx > 0 ? i - 1 : -1, cx < W - 1 ? i + 1 : -1, cy > 0 ? i - W : -1, cy < H - 1 ? i + W : -1]) {
        if (j >= 0 && !label[j] && prob[j] > THRESH) { label[j] = next; stack[top++] = j; }
      }
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    if (w < 3 || h < 3 || sum / n < BOX_THRESH) continue;
    const d = (w * h * UNCLIP) / (2 * (w + h));
    boxes.push([
      Math.max(0, Math.floor((x0 - d) / k)),
      Math.max(0, Math.floor((y0 - d) / k)),
      Math.min(img.width, Math.ceil((x1 + 1 + d) / k)),
      Math.min(img.height, Math.ceil((y1 + 1 + d) / k)),
    ]);
  }
  return boxes.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

export async function recognize(session: ort.InferenceSession, keys: string[], img: Img, box: BBox): Promise<OcrLine> {
  const w = box[2] - box[0];
  const h = box[3] - box[1];
  const rw = Math.max(8, Math.min(REC_MAX_W, Math.ceil((REC_H * w) / h)));
  const r = resize(crop(img, box), rw, REC_H);
  const plane = rw * REC_H;
  const x = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) for (let ch = 0; ch < 3; ch++) x[ch * plane + i] = r.data[i * 4 + ch] / 127.5 - 1;
  const out = Object.values(await session.run({ x: new ort.Tensor('float32', x, [1, 3, REC_H, rw]) }))[0];
  const [, T, C] = out.dims;
  const p = out.data as Float32Array;

  let text = '';
  const at: number[] = [];
  let prev = 0;
  for (let t = 0; t < T; t++) {
    let best = 0;
    for (let c = 1; c < C; c++) if (p[t * C + c] > p[t * C + best]) best = c;
    if (best !== 0 && best !== prev) {
      text += best <= keys.length ? keys[best - 1] : ' ';
      at.push(box[0] + ((t + 0.5) * w) / T);
    }
    prev = best;
  }
  const chars = at.map((c, i): [number, number] => [
    i === 0 ? box[0] : (at[i - 1] + c) / 2,
    i === at.length - 1 ? box[2] : (c + at[i + 1]) / 2,
  ]);
  return { text, bbox: box, chars };
}

export async function readText(det: ort.InferenceSession, rec: ort.InferenceSession, keys: string[], img: Img): Promise<OcrLine[]> {
  const lines: OcrLine[] = [];
  for (const box of await detectText(det, img)) {
    const line = await recognize(rec, keys, img, box);
    if (line.text.trim()) lines.push(line);
  }
  return lines;
}

import * as ort from 'onnxruntime-web';
import type { BBox } from '../vrs';
import { crop, type Img } from './image';
import { detectFaces } from './face';
import { keysFrom, readText, type OcrLine } from './ocr';
import { findCodes } from './qr';
import { findNames, vocabFrom, type Name } from '../pii/ner';

// Runs in an extension page (Chrome offscreen document, Firefox background page), never in the web page.

export interface VisionRequest { image: string; viewport: [number, number]; rasters: { key: string; bbox: BBox }[] }
/** Results in viewport (CSS pixel) coordinates. ok=false means the raster must be masked whole (fail closed). */
export interface RasterVision { key: string; ok: boolean; faces: BBox[]; codes: BBox[]; lines: OcrLine[]; error?: string }
export interface VisionResult { backend: string; rasters: RasterVision[]; ms: number }

const MAX_RASTERS = 6;
const BUDGET_MS = 5000;
const IDLE_MS = 60_000;
const BASE = () => new URL('/models/', location.href).href;

export interface Models { face: ort.InferenceSession; det: ort.InferenceSession; rec: ort.InferenceSession; keys: string[]; backend: string }

const bytes = async (name: string) => new Uint8Array(await (await fetch(BASE() + name)).arrayBuffer());
let gpu: Promise<boolean> | undefined;
async function open(buf: Uint8Array): Promise<ort.InferenceSession> {
  gpu ??= typeof navigator !== 'undefined' && 'gpu' in navigator
    ? (navigator as any).gpu.requestAdapter().then((a: unknown) => !!a, () => false)
    : Promise.resolve(false);
  if (await gpu) try { return await ort.InferenceSession.create(buf, { executionProviders: ['webgpu'] }); } catch { /* fall back to WASM */ }
  return ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
}

/** Loads on first use and releases the sessions after a minute without use, keeping idle memory low. */
function lazy<T>(load: () => Promise<T>, sessions: (t: T) => ort.InferenceSession[]): () => Promise<T> {
  let p: Promise<T> | null = null;
  let idle: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(idle);
    p ??= load().catch((e) => { p = null; throw e; });
    const cur = p;
    idle = setTimeout(() => {
      if (p !== cur) return;
      p = null;
      cur.then((t) => sessions(t).forEach((s) => s.release()), () => {});
    }, IDLE_MS);
    return cur;
  };
}

const getModels = lazy<Models>(async () => {
  const [face, det, rec] = await Promise.all(['yunet.onnx', 'ocr-det.onnx', 'ocr-rec.onnx'].map(bytes));
  return { face: await open(face), det: await open(det), rec: await open(rec), keys: keysFrom(rec), backend: (await gpu) ? 'webgpu' : 'wasm' };
}, (m) => [m.face, m.det, m.rec]);

// NER is the largest model (66 MB), so it loads only once a page has free text worth checking.
const getNer = lazy(async () => {
  const [model, vocab] = await Promise.all([bytes('ner.onnx'), bytes('ner-vocab.txt')]);
  return { session: await open(model), vocab: vocabFrom(new TextDecoder().decode(vocab)) };
}, (n) => [n.session]);

export async function names(texts: string[]): Promise<Name[]> {
  const n = await getNer();
  return findNames(n.session, n.vocab, texts);
}

export async function analyzeImage(m: Models, img: Img): Promise<Omit<RasterVision, 'key' | 'ok'>> {
  const faces = await detectFaces(m.face, img);
  const lines = await readText(m.det, m.rec, m.keys, img);
  return { faces, codes: findCodes(img), lines };
}

async function decode(dataUrl: string): Promise<Img> {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, c.width, c.height);
}

export async function analyze(req: VisionRequest): Promise<VisionResult> {
  const t0 = performance.now();
  const fail = (key: string, error: string): RasterVision => ({ key, ok: false, faces: [], codes: [], lines: [], error });
  let m: Models;
  try {
    m = await getModels();
  } catch (e) {
    return { backend: 'none', rasters: req.rasters.map((r) => fail(r.key, `models unavailable: ${e}`)), ms: Math.round(performance.now() - t0) };
  }
  const frame = await decode(req.image);
  const k = frame.width / req.viewport[0];
  const area = (b: BBox) => (b[2] - b[0]) * (b[3] - b[1]);
  const order = [...req.rasters].sort((a, b) => area(b.bbox) - area(a.bbox));

  const rasters: RasterVision[] = [];
  for (const [i, r] of order.entries()) {
    if (i >= MAX_RASTERS) { rasters.push(fail(r.key, 'too many images on screen')); continue; }
    if (performance.now() - t0 > BUDGET_MS) { rasters.push(fail(r.key, 'time budget exceeded')); continue; }
    const box: BBox = [
      Math.max(0, Math.floor(r.bbox[0] * k)),
      Math.max(0, Math.floor(r.bbox[1] * k)),
      Math.min(frame.width, Math.ceil(r.bbox[2] * k)),
      Math.min(frame.height, Math.ceil(r.bbox[3] * k)),
    ];
    if (box[2] - box[0] < 8 || box[3] - box[1] < 8) { rasters.push(fail(r.key, 'off screen')); continue; }
    try {
      const v = await analyzeImage(m, crop(frame, box));
      const toView = (b: BBox): BBox => [(b[0] + box[0]) / k, (b[1] + box[1]) / k, (b[2] + box[0]) / k, (b[3] + box[1]) / k];
      rasters.push({
        key: r.key,
        ok: true,
        faces: v.faces.map(toView),
        codes: v.codes.map(toView),
        lines: v.lines.map((l) => ({ text: l.text, bbox: toView(l.bbox), chars: l.chars.map(([a, b]) => [(a + box[0]) / k, (b + box[0]) / k]) })),
      });
    } catch (e) {
      rasters.push(fail(r.key, String(e)));
    }
  }
  return { backend: m.backend, rasters, ms: Math.round(performance.now() - t0) };
}

/** Paranoid mode: read back all text in the outgoing (already redacted) frame for the egress firewall. */
export async function audit(image: string): Promise<string[]> {
  const m = await getModels();
  return (await readText(m.det, m.rec, m.keys, await decode(image))).map((l) => l.text);
}

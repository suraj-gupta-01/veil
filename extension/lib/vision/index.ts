import * as ort from 'onnxruntime-web';
import type { BBox } from '../vrs';
import { crop, type Img } from './image';
import { detectFaces } from './face';
import { keysFrom, readText, type OcrLine } from './ocr';
import { findCodes } from './qr';

// Runs in an extension page (Chrome offscreen document, Firefox background page), never in the web page.

export interface VisionRequest { image: string; viewport: [number, number]; rasters: { key: string; bbox: BBox }[] }
/** Results in viewport (CSS pixel) coordinates. ok=false means the raster must be masked whole (fail closed). */
export interface RasterVision { key: string; ok: boolean; faces: BBox[]; codes: BBox[]; lines: OcrLine[]; error?: string }
export interface VisionResult { backend: string; rasters: RasterVision[]; ms: number }

const MAX_RASTERS = 6;
const BUDGET_MS = 5000;
const IDLE_MS = 60_000;

export interface Models { face: ort.InferenceSession; det: ort.InferenceSession; rec: ort.InferenceSession; keys: string[]; backend: string }
let models: Promise<Models> | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;

async function load(base: string): Promise<Models> {
  const bytes = async (name: string) => new Uint8Array(await (await fetch(base + name)).arrayBuffer());
  const [face, det, rec] = await Promise.all(['yunet.onnx', 'ocr-det.onnx', 'ocr-rec.onnx'].map(bytes));
  const gpu = typeof navigator !== 'undefined' && 'gpu' in navigator && !!(await (navigator as any).gpu.requestAdapter().catch(() => null));
  const open = async (buf: Uint8Array) => {
    if (gpu) try { return await ort.InferenceSession.create(buf, { executionProviders: ['webgpu'] }); } catch { /* fall back to WASM */ }
    return ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
  };
  return { face: await open(face), det: await open(det), rec: await open(rec), keys: keysFrom(rec), backend: gpu ? 'webgpu' : 'wasm' };
}

/** Sessions are created once and released after a minute without use, keeping idle memory low. */
function getModels(base: string): Promise<Models> {
  clearTimeout(idle);
  models ??= load(base).catch((e) => { models = null; throw e; });
  const current = models;
  idle = setTimeout(() => {
    if (models !== current) return;
    models = null;
    current.then((m) => [m.face, m.det, m.rec].forEach((s) => s.release()), () => {});
  }, IDLE_MS);
  return current;
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

/** `base` defaults to the extension's /models/ folder, since this runs on an extension page. */
export async function analyze(req: VisionRequest, base = new URL('/models/', location.href).href): Promise<VisionResult> {
  const t0 = performance.now();
  const fail = (key: string, error: string): RasterVision => ({ key, ok: false, faces: [], codes: [], lines: [], error });
  let m: Models;
  try {
    m = await getModels(base);
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

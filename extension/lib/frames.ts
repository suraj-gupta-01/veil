import type { RawRaster, RawSnapshot } from './messages';
import type { BBox } from './vrs';

// Iframes: the content script runs in every frame. Direct child frames are matched to their <iframe> element in the
// top snapshot, and their elements and text are folded in at page coordinates. Anything unmatched stays a raster
// and is handled like an image (vision, or masked whole).

export interface FrameInfo { frameId: number; url: string; size: [number, number] }
export interface Route { frameId: number; vid: number; origin: string }

const originOf = (url: string) => { try { return new URL(url).origin; } catch { return 'null'; } };

/** Pairs each child frame with the one <iframe> of the same content size and origin. Ambiguous pairs are skipped. */
export function matchFrames(top: RawSnapshot, frames: FrameInfo[]): { frame: FrameInfo; raster: RawRaster }[] {
  const fits = (r: RawRaster, f: FrameInfo) =>
    r.kind === 'iframe' && !!r.inner && !!r.src &&
    Math.abs(r.inner[2] - r.inner[0] - f.size[0]) <= 2 && Math.abs(r.inner[3] - r.inner[1] - f.size[1]) <= 2 &&
    originOf(r.src) === originOf(f.url) && originOf(f.url) !== 'null';
  const out: { frame: FrameInfo; raster: RawRaster }[] = [];
  for (const frame of frames) {
    const rs = top.rasters.filter((r) => fits(r, frame));
    if (rs.length === 1 && frames.filter((f) => fits(rs[0], f)).length === 1) out.push({ frame, raster: rs[0] });
  }
  return out;
}

/** Folds child snapshots into the top one: shifts boxes by the iframe's content offset and renumbers ids. */
export function mergeFrames(
  top: RawSnapshot,
  children: { frameId: number; url: string; raster: RawRaster; snap: RawSnapshot }[],
): { raw: RawSnapshot; routes: Map<number, Route> } {
  const routes = new Map<number, Route>();
  if (!children.length) return { raw: top, routes };
  let next = Math.max(0, ...top.elements.map((e) => e.vid), ...top.texts.map((t) => t.vid), ...top.rasters.map((r) => r.vid)) + 1;
  const raw: RawSnapshot = { ...top, elements: [...top.elements], texts: [...top.texts], rasters: top.rasters.filter((r) => !children.some((c) => c.raster === r)) };

  for (const c of children) {
    const [dx, dy] = c.raster.inner!;
    const shift = (b: BBox): BBox => [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy];
    const origin = originOf(c.url);
    const renumber = (vid: number) => { const id = next++; routes.set(id, { frameId: c.frameId, vid, origin }); return id; };
    for (const e of c.snap.elements) raw.elements.push({ ...e, vid: renumber(e.vid), bbox: shift(e.bbox), valueBox: shift(e.valueBox) });
    for (const t of c.snap.texts) raw.texts.push({ ...t, vid: next++, bbox: shift(t.bbox), spans: t.spans.map((s) => ({ ...s, rects: s.rects.map(shift) })) });
    for (const r of c.snap.rasters) raw.rasters.push({ ...r, vid: next++, bbox: shift(r.bbox), inner: undefined });
  }
  return { raw, routes };
}

import type { RawElement, RawRaster, RawSnapshot, Mask, Mark } from './messages';
import type { BBox, TokenClass, VElement, VScreen, VText } from './vrs';
import { classFromAutocomplete, classFromContext, classFromOcrLabel, detectAll, detectLabelValue, dictSpans, mergeSpans, type Span, type Term } from './pii/rules';
import type { OcrLine } from './vision/ocr';
import type { RasterVision } from './vision';
import { sanitizeUrl } from './url';
import type { Vault } from './vault';

export interface Sanitized {
  screen: Omit<VScreen, 'image'>;
  masks: Mask[];
  marks: Mark[];
  fieldClasses: Map<number, TokenClass | undefined>;
  labels: Map<number, string>;
  needsResnap: boolean;
}

const FIELD_ROLES = new Set(['textbox', 'password', 'combobox']);
const MARK_ROLES = new Set(['textbox', 'password', 'combobox', 'checkbox', 'radio', 'button', 'link']);
const MAX_TEXTS = 150;
const MAX_TEXT_LEN = 300;
// When the page itself says what an image is, trust it and mask the whole image as that class.
const HINTS: [RegExp, TokenClass][] = [
  [/\b(qr|bar ?code)\b/i, 'QR'],
  [/\b(photo of|portrait|selfie|avatar|profile (photo|picture|pic)|face)\b/i, 'FACE'],
];
const hintFor = (r: RawRaster) => HINTS.find(([re]) => re.test(r.alt))?.[1];

/** Vision results are matched to rasters by position, so a resnap with a moved image fails closed. */
export const rasterKey = (r: RawRaster) => r.bbox.join(',');

export const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

export function sanitizeText(text: string, vault: Vault, source: string): { text: string; hit: boolean } {
  if (!text) return { text: '', hit: false };
  const spans = detectAll(text, vault.dictionary());
  let out = text;
  for (const s of [...spans].reverse()) {
    out = out.slice(0, s.start) + (s.token ?? vault.tokenFor(s.cls, s.value, source, s.valid)) + out.slice(s.end);
  }
  return { text: out, hit: spans.length > 0 };
}

export function fieldClassOf(el: RawElement): TokenClass | undefined {
  if (el.type === 'password') return 'SECRET';
  return classFromAutocomplete(el.autocomplete) ?? classFromContext(el.label, el.name, el.idAttr, el.placeholder);
}

/** L1 patterns, label: value pairs, the vault dictionary, then L4: a label to the left on the same row. */
function lineSpans(line: OcrLine, all: OcrLine[], terms: Term[]): Span[] {
  const spans = mergeSpans(detectAll(line.text, terms), detectLabelValue(line.text));
  if (spans.length) return spans;
  const [x0, y0, , y1] = line.bbox;
  const cy = (y0 + y1) / 2;
  const label = all
    .filter((o) => o !== line && o.bbox[2] <= x0 + 2 && Math.abs((o.bbox[1] + o.bbox[3]) / 2 - cy) < (y1 - y0) / 2)
    .sort((a, b) => b.bbox[2] - a.bbox[2])[0];
  const cls = label && label.text.length <= 40 ? classFromOcrLabel(label.text) : undefined;
  if (!cls) return [];
  const start = line.text.search(/\S/);
  const end = line.text.trimEnd().length;
  return [{ cls, start, end, value: line.text.slice(start, end), layer: 'L4' }];
}

function charRect(line: OcrLine, start: number, end: number): BBox {
  const c = line.chars.length === line.text.length ? line.chars : null;
  return [c ? c[start][0] : line.bbox[0], line.bbox[1], c ? c[end - 1][1] : line.bbox[2], line.bbox[3]].map(Math.round) as BBox;
}

function guessState(raw: RawSnapshot): VScreen['state'] {
  const pw = raw.elements.some((e) => e.role === 'password');
  const boxes = raw.elements.filter((e) => e.role === 'textbox').length;
  if (pw && boxes <= 2) return { class: 'login', confidence: 0.6, src: 'heuristic' };
  if (boxes >= 3) return { class: 'form', confidence: 0.6, src: 'heuristic' };
  if (raw.rasters.length && raw.texts.length < 40) return { class: 'document', confidence: 0.4, src: 'heuristic' };
  return { class: 'generic', confidence: 0.4, src: 'heuristic' };
}

export function sanitize(raw: RawSnapshot, vault: Vault, source: string, vision = new Map<string, RasterVision>()): Sanitized {
  const masks: Mask[] = [];
  const marks: Mark[] = [];
  const fieldClasses = new Map<number, TokenClass | undefined>();
  const labels = new Map<number, string>();
  const elements: VElement[] = [];
  const clean = (s: string) => sanitizeText(s, vault, source);
  let nextId = Math.max(0, ...raw.elements.map((e) => e.vid), ...raw.texts.map((t) => t.vid), ...raw.rasters.map((r) => r.vid)) + 1;

  // Learn values read from images first, so DOM labels and values below are checked against them too.
  const seen = new Map<RawRaster, RasterVision>();
  for (const r of raw.rasters) {
    const v = vision.get(rasterKey(r));
    if (!v?.ok || hintFor(r)) continue;
    seen.set(r, v);
    for (const line of v.lines) for (const s of lineSpans(line, v.lines, [])) vault.tokenFor(s.cls, s.value, source, s.valid);
  }

  for (const el of raw.elements) {
    const fc = FIELD_ROLES.has(el.role) ? fieldClassOf(el) : undefined;
    fieldClasses.set(el.vid, fc);
    const label = clean(el.label).text;
    labels.set(el.vid, label);

    let value = '';
    if (el.role === 'password' || fc === 'SECRET') {
      if (el.hasValue) {
        value = vault.secretFor(`${source}|${collapse(el.label) || el.name || el.idAttr}`, source);
        masks.push({ bbox: el.valueBox, label: value, field: true });
      }
    } else if (el.value) {
      if (fc) {
        value = vault.tokenFor(fc, el.value, source);
        masks.push({ bbox: el.valueBox, label: value, field: true });
      } else {
        const s = clean(el.value);
        value = s.text;
        if (s.hit) masks.push({ bbox: el.valueBox, label: 'REDACTED', field: true });
      }
    }

    const v: VElement = { id: el.vid, role: el.role, label, bbox: el.bbox, src: 'dom' };
    if (FIELD_ROLES.has(el.role)) v.value = value;
    if (el.placeholder) v.placeholder = clean(el.placeholder).text;
    if (fc) v.field_class = fc;
    if (el.required) v.required = true;
    if (el.disabled) v.disabled = true;
    if (el.checked !== undefined) v.checked = el.checked;
    if (el.options) v.options = el.options.slice(0, 30).map((o) => clean(o).text);
    elements.push(v);
    if (MARK_ROLES.has(el.role)) marks.push({ id: el.vid, bbox: el.bbox });
  }

  const texts: VText[] = [];
  const terms = vault.dictionary();
  for (const r of raw.rasters) {
    const v = seen.get(r);
    const el: VElement = { id: r.vid, role: 'image', label: collapse(clean(r.alt).text) || r.kind, bbox: r.bbox, src: 'dom' };
    elements.push(el);
    if (!v) {
      // Fail closed: vision failed or timed out, or the page says the image is a code or a portrait.
      el.masked = true;
      const hint = hintFor(r);
      masks.push({ bbox: r.bbox, label: hint ? vault.tokenFor(hint, `${source}|${r.alt}`, source) : 'IMAGE' });
      continue;
    }
    v.faces.forEach((b, i) => masks.push({ bbox: b, label: vault.tokenFor('FACE', `${source}|${r.alt}|face${i}`, source) }));
    v.codes.forEach((b, i) => masks.push({ bbox: b, label: vault.tokenFor('QR', `${source}|${r.alt}|code${i}`, source) }));
    for (const line of v.lines) {
      let text = line.text;
      for (const s of [...lineSpans(line, v.lines, terms)].reverse()) {
        const tok = s.token ?? vault.tokenFor(s.cls, s.value, source, s.valid);
        text = text.slice(0, s.start) + tok + text.slice(s.end);
        masks.push({ bbox: charRect(line, s.start, s.end), label: tok });
      }
      if (texts.length < MAX_TEXTS) texts.push({ id: nextId++, text: collapse(text).slice(0, MAX_TEXT_LEN), bbox: line.bbox.map(Math.round) as BBox });
    }
  }

  let needsResnap = false;
  for (const t of raw.texts) {
    let text = t.text;
    for (const s of [...t.spans].sort((a, b) => b.start - a.start)) {
      const tok = s.token && vault.get(s.token) ? s.token : vault.tokenFor(s.cls, s.value, source, s.valid);
      text = text.slice(0, s.start) + tok + text.slice(s.end);
      for (const rect of s.rects) masks.push({ bbox: rect, label: tok });
    }
    const late = dictSpans(text.replace(/⟦[A-Z_]+_\d+⟧/g, (m) => ' '.repeat(m.length)), terms);
    if (late.length) {
      needsResnap = true;
      for (const s of [...late].reverse()) text = text.slice(0, s.start) + (s.token ?? vault.tokenFor(s.cls, s.value, source)) + text.slice(s.end);
    }
    if (texts.length < MAX_TEXTS) texts.push({ id: t.vid, text: collapse(text).slice(0, MAX_TEXT_LEN), bbox: t.bbox });
  }

  const { origin, path_template } = sanitizeUrl(raw.url);
  return {
    screen: {
      origin,
      path_template,
      title: clean(raw.title).text,
      state: guessState(raw),
      viewport: raw.viewport,
      elements,
      texts,
    },
    masks,
    marks,
    fieldClasses,
    labels,
    needsResnap,
  };
}

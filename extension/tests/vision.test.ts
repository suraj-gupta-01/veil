import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as ort from 'onnxruntime-web';
import { analyzeImage, type Models, type RasterVision } from '@/lib/vision';
import { rasterKey, sanitize } from '@/lib/sanitize';
import { firewall } from '@/lib/egress';
import { Vault } from '@/lib/vault';
import type { RawSnapshot } from '@/lib/messages';
import { keysFrom } from '@/lib/vision/ocr';
import { findCodes } from '@/lib/vision/qr';
import type { Img } from '@/lib/vision/image';
import type { BBox } from '@/lib/vrs';
import { readPng } from './png';

const MODELS = new URL('../public/models/', import.meta.url);
const CARD = new URL('../../demo-sites/id-card-scan.png', import.meta.url);
const haveModels = ['yunet.onnx', 'ocr-det.onnx', 'ocr-rec.onnx'].every((f) => existsSync(new URL(f, MODELS)));
const inside = (b: BBox, o: BBox) => b[0] >= o[0] && b[1] >= o[1] && b[2] <= o[2] && b[3] <= o[3];

function blank(w: number, h: number): Img {
  return { data: new Uint8ClampedArray(w * h * 4).fill(255), width: w, height: h };
}

function square(img: Img, x: number, y: number, s: number, dark: boolean) {
  for (let j = y; j < y + s; j++) for (let i = x; i < x + s; i++) img.data.fill(dark ? 0 : 255, (j * img.width + i) * 4, (j * img.width + i) * 4 + 3);
}

function finder(img: Img, x: number, y: number, m: number) {
  square(img, x, y, 7 * m, true);
  square(img, x + m, y + m, 5 * m, false);
  square(img, x + 2 * m, y + 2 * m, 3 * m, true);
}

describe('QR finder', () => {
  it('locates a code from its three finder patterns', () => {
    const img = blank(300, 200);
    const m = 4;
    finder(img, 100, 40, m);
    finder(img, 100 + 18 * m, 40, m);
    finder(img, 100, 40 + 18 * m, m);
    const codes = findCodes(img);
    expect(codes).toHaveLength(1);
    expect(inside([100, 40, 100 + 25 * m, 40 + 25 * m], codes[0])).toBe(true);
    expect(codes[0][2] - codes[0][0]).toBeLessThan(40 * m);
  });

  it('ignores text-like stripes', () => {
    const img = blank(200, 100);
    for (let x = 10; x < 190; x += 6) square(img, x, 30, 3, true);
    expect(findCodes(img)).toHaveLength(0);
  });
});

describe.skipIf(!haveModels)('vision models on the ID card scan', async () => {
  const bytes = (f: string) => readFileSync(new URL(f, MODELS));
  const open = (f: string) => ort.InferenceSession.create(bytes(f), { executionProviders: ['wasm'] });
  const m: Models = haveModels
    ? { face: await open('yunet.onnx'), det: await open('ocr-det.onnx'), rec: await open('ocr-rec.onnx'), keys: keysFrom(bytes('ocr-rec.onnx')), backend: 'wasm' }
    : (null as never);
  const v = haveModels ? await analyzeImage(m, readPng(fileURLToPath(CARD))) : (null as never);

  it('reads every value on the card', () => {
    const texts = v.lines.map((l) => l.text);
    for (const want of ['Ananya Rao', '12-08-1999', '4821 6630 1979', 'ABCPR1234K', 'ananya.rao@mail.in', 'Aadhaar']) expect(texts).toContain(want);
    // OCR can drop the gap after a country code; the phone detector accepts both forms.
    expect(texts.map((t) => t.replace(/\s/g, ''))).toContain('+919845012345');
    expect(texts.some((t) => t.startsWith('14, 3rd Cross'))).toBe(true);
  });

  it('gives each character its own horizontal extent', () => {
    const line = v.lines.find((l) => l.text === '4821 6630 1979')!;
    expect(line.chars).toHaveLength(line.text.length);
    for (let i = 1; i < line.chars.length; i++) expect(line.chars[i][0]).toBeGreaterThanOrEqual(line.chars[i - 1][0]);
    expect(line.chars[0][0]).toBe(line.bbox[0]);
    expect(line.chars.at(-1)![1]).toBe(line.bbox[2]);
  });

  it('finds the portrait face and the QR code', () => {
    expect(v.faces).toHaveLength(1);
    expect(inside(v.faces[0], [20, 80, 210, 310])).toBe(true);
    expect(v.codes).toHaveLength(1);
    expect(inside([787, 92, 910, 215], v.codes[0])).toBe(true);
  });
});

const SRC = 'https://docs.demo.local';
const CARD_AT: BBox = [100, 100, 1040, 540];

function page(alt = 'Scanned identity card'): RawSnapshot {
  return {
    url: `${SRC}/documents/id`, title: 'My documents', viewport: [1280, 720], dpr: 1, ms: 1,
    elements: [], texts: [], rasters: [{ vid: 1, kind: 'img', alt, bbox: CARD_AT }],
  };
}

const line = (text: string, x0: number, y0: number, x1: number, y1: number) => ({
  text, bbox: [x0, y0, x1, y1] as BBox, chars: [...text].map((_, i): [number, number] => [x0 + ((x1 - x0) * i) / text.length, x0 + ((x1 - x0) * (i + 1)) / text.length]),
});

function seen(v: Partial<RasterVision>, raw = page()) {
  return new Map([[rasterKey(raw.rasters[0]), { key: rasterKey(raw.rasters[0]), ok: true, faces: [], codes: [], lines: [], ...v }]]);
}

describe('sanitize with vision', () => {
  it('masks an image whole when vision failed or did not run', () => {
    for (const vision of [undefined, seen({ ok: false, error: 'timeout' })]) {
      const s = sanitize(page(), new Vault(), SRC, vision);
      expect(s.masks).toEqual([{ bbox: CARD_AT, label: 'IMAGE' }]);
      expect(s.screen.elements[0].masked).toBe(true);
    }
  });

  it('masks an image whole as a code when the page labels it a QR code', () => {
    const raw = page('Secure QR code');
    const v = new Vault();
    const s = sanitize(raw, v, SRC, seen({}, raw));
    expect(s.masks).toEqual([{ bbox: CARD_AT, label: '⟦QR_1⟧' }]);
    expect(v.get('⟦QR_1⟧')?.value).toBe('');
  });

  it('masks faces, codes and only the sensitive characters of text read from pixels', () => {
    const v = new Vault();
    const lines = [
      line('Aadhaar', 330, 270, 395, 290),
      line('4821 6630 1979', 470, 270, 600, 290),
      line('Name', 330, 195, 378, 215),
      line('Ananya Rao', 470, 195, 570, 215),
      line('Call 98450 12345 today', 330, 330, 540, 350),
      line('Identity card', 120, 120, 260, 140),
    ];
    const s = sanitize(page(), v, SRC, seen({ faces: [[140, 200, 260, 340]], codes: [[880, 190, 1015, 320]], lines }));
    expect(s.screen.elements[0].masked).toBeUndefined();
    const texts = s.screen.texts.map((t) => t.text);
    expect(texts).toEqual(expect.arrayContaining(['Aadhaar', '⟦AADHAAR_1⟧', 'Name', '⟦NAME_1⟧', 'Call ⟦PHONE_1⟧ today', 'Identity card']));
    const labels = s.masks.map((m) => m.label);
    expect(labels).toEqual(expect.arrayContaining(['⟦FACE_1⟧', '⟦QR_1⟧', '⟦AADHAAR_1⟧', '⟦NAME_1⟧', '⟦PHONE_1⟧']));
    expect(labels).not.toContain('IMAGE');
    const phone = s.masks.find((m) => m.label === '⟦PHONE_1⟧')!.bbox;
    expect(phone[0]).toBeGreaterThan(330 + 40);
    expect(phone[2]).toBeLessThan(540 - 40);
    expect(v.get('⟦AADHAAR_1⟧')).toMatchObject({ value: '4821 6630 1979', valid: true });
    expect(v.get('⟦NAME_1⟧')?.value).toBe('Ananya Rao');
  });

  it('reads OCR labels whose spaces were dropped', () => {
    const v = new Vault();
    const s = sanitize(page(), v, SRC, seen({ lines: [line('Dateof birth', 330, 230, 420, 250), line('12-08-1999', 470, 230, 560, 250)] }));
    expect(s.screen.texts.map((t) => t.text)).toEqual(['Dateof birth', '⟦DOB_1⟧']);
  });

  it('checks DOM text against names first read from an image', () => {
    const raw = page();
    raw.elements.push({
      vid: 2, role: 'textbox', tag: 'input', type: 'text', label: 'Notes', value: 'For Ananya Rao', hasValue: true, placeholder: '',
      name: '', idAttr: '', autocomplete: '', required: false, disabled: false, bbox: [0, 600, 200, 620], valueBox: [2, 602, 198, 618],
    });
    const s = sanitize(raw, new Vault(), SRC, seen({ lines: [line('Name', 330, 195, 378, 215), line('Ananya Rao', 470, 195, 570, 215)] }, raw));
    expect(s.screen.elements.find((e) => e.id === 2)!.value).toBe('For ⟦NAME_1⟧');
    expect(s.screen.texts.every((t) => t.id !== 2 && t.id > 1)).toBe(true);
  });
});

describe.skipIf(!haveModels)('ID card scan end to end', async () => {
  const bytes = (f: string) => readFileSync(new URL(f, MODELS));
  const open = (f: string) => ort.InferenceSession.create(bytes(f), { executionProviders: ['wasm'] });
  const m: Models = haveModels
    ? { face: await open('yunet.onnx'), det: await open('ocr-det.onnx'), rec: await open('ocr-rec.onnx'), keys: keysFrom(bytes('ocr-rec.onnx')), backend: 'wasm' }
    : (null as never);

  it('tokenizes every identifier on the card and passes the egress firewall', async () => {
    const v0 = await analyzeImage(m, readPng(fileURLToPath(CARD)));
    const shift = (b: BBox): BBox => [b[0] + 100, b[1] + 100, b[2] + 100, b[3] + 100];
    const vision = seen({
      faces: v0.faces.map(shift), codes: v0.codes.map(shift),
      lines: v0.lines.map((l) => ({ text: l.text, bbox: shift(l.bbox), chars: l.chars.map(([a, b]): [number, number] => [a + 100, b + 100]) })),
    });
    const vault = new Vault();
    const s = sanitize(page(), vault, SRC, vision);
    const classes = vault.entities().map((e) => e.class);
    expect(classes).toEqual(expect.arrayContaining(['NAME', 'DOB', 'AADHAAR', 'PAN', 'PHONE', 'EMAIL', 'ADDRESS', 'FACE', 'QR']));
    const req = { session_id: 's', vrs_version: '1.0', goal: 'Open an account', step: 1, mode: 'pixel' as const, screen: { ...s.screen, image: 'data:,' }, entities: vault.entities(), history: [] };
    const fw = firewall(req, vault, 'http://localhost:8000/v1/step', 'http://localhost:8000', true);
    expect(fw.checks.filter((c) => !c.ok)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { matchFrames, mergeFrames } from '@/lib/frames';
import { Vault } from '@/lib/vault';
import { sanitize } from '@/lib/sanitize';
import type { RawElement, RawSnapshot } from '@/lib/messages';

function snap(p: Partial<RawSnapshot>): RawSnapshot {
  return { url: 'https://shop.demo/checkout', title: 'Checkout', viewport: [1280, 720], dpr: 1, ms: 1, elements: [], texts: [], rasters: [], ...p };
}
const input = (vid: number, label: string, autocomplete = ''): RawElement => ({
  vid, role: 'textbox', tag: 'input', type: 'text', label, value: '', hasValue: false, placeholder: '', name: '', idAttr: '', autocomplete,
  required: false, disabled: false, bbox: [10, 10, 210, 40], valueBox: [12, 12, 208, 38],
});

const top = snap({
  elements: [input(1, 'Email', 'email')],
  rasters: [
    { vid: 2, kind: 'iframe', alt: 'Card payment', bbox: [100, 300, 504, 504], src: 'https://pay.demo/card', inner: [102, 302, 502, 502] },
    { vid: 3, kind: 'iframe', alt: 'Ad', bbox: [700, 300, 1004, 554], src: 'https://ads.demo/x', inner: [702, 302, 1002, 552] },
  ],
});

describe('frames', () => {
  it('matches a child frame to its iframe by content size and origin only', () => {
    const frames = [
      { frameId: 7, url: 'https://pay.demo/card?session=1', size: [400, 200] as [number, number] },
      { frameId: 8, url: 'https://other.demo/', size: [300, 250] as [number, number] },
    ];
    expect(matchFrames(top, frames).map((m) => [m.frame.frameId, m.raster.vid])).toEqual([[7, 2]]);
  });

  it('skips ambiguous matches, so the iframe stays masked', () => {
    const twin = snap({ rasters: [top.rasters[0], { ...top.rasters[0], vid: 9, bbox: [0, 0, 404, 204], inner: [2, 2, 402, 202] }] });
    expect(matchFrames(twin, [{ frameId: 7, url: 'https://pay.demo/card', size: [400, 200] }])).toEqual([]);
  });

  it('folds the frame in at page coordinates with fresh ids and routes back to the frame', () => {
    const child = snap({ url: 'https://pay.demo/card', elements: [input(1, 'Card number', 'cc-number'), input(2, 'CVV', 'cc-csc')] });
    const { raw, routes } = mergeFrames(top, [{ frameId: 7, url: child.url, raster: top.rasters[0], snap: child }]);
    expect(raw.rasters.map((r) => r.vid)).toEqual([3]);
    const card = raw.elements.find((e) => e.label === 'Card number')!;
    expect(card.bbox).toEqual([112, 312, 312, 342]);
    expect(card.vid).toBeGreaterThan(3);
    expect(routes.get(card.vid)).toEqual({ frameId: 7, vid: 1, origin: 'https://pay.demo' });

    const s = sanitize(raw, new Vault(), 'https://shop.demo');
    expect(s.screen.elements.find((e) => e.id === card.vid)!.field_class).toBe('CARD');
    expect(s.masks.some((m) => m.label === 'IMAGE' && m.bbox[0] === 100)).toBe(false);
  });
});

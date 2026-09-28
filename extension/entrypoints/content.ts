import { classFromContext, detectAll, detectLabelValue, mergeSpans, type Span, type Term } from '@/lib/pii/rules';
import type { ExecAction, ExecResult, RawElement, RawRaster, RawSnapshot, RawText } from '@/lib/messages';
import type { BBox, Role } from '@/lib/vrs';

const INTERACTIVE =
  'input:not([type=hidden]),textarea,select,button,a[href],summary,' +
  '[role=button],[role=link],[role=checkbox],[role=radio],[role=textbox],[role=combobox],' +
  '[contenteditable=""],[contenteditable="true"]';
const RASTER = 'img,canvas,video,iframe,embed,object,svg';
const NO_TEXT = 'script,style,noscript,template,textarea,select,svg';
const REJECT = 2;
const ACCEPT = 1;

let registry = new Map<number, HTMLElement>();

const toBox = (r: DOMRect | DOMRectReadOnly): BBox => [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)];
const inViewport = (r: DOMRect) => r.width > 1 && r.height > 1 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;

function isVisible(el: Element, r: DOMRect): boolean {
  if (!inViewport(r)) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
}

function textOf(el: Element | null, max = 120): string {
  if (!el) return '';
  let out = '';
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('select,textarea,script,style') ? REJECT : ACCEPT),
  });
  while (w.nextNode() && out.length < max * 2) out += w.currentNode.nodeValue;
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

function shortText(el: Element | null): string {
  const t = textOf(el, 80);
  return t.length <= 60 ? t : '';
}

function roleOf(el: Element): Role {
  const ar = el.getAttribute('role');
  if (ar && ['button', 'link', 'checkbox', 'radio', 'textbox', 'combobox'].includes(ar)) return ar as Role;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const t = (el as HTMLInputElement).type;
    if (t === 'password') return 'password';
    if (t === 'checkbox' || t === 'radio') return t;
    if (['submit', 'button', 'reset', 'image', 'file'].includes(t)) return 'button';
    if (['range', 'color'].includes(t)) return 'other';
    return 'textbox';
  }
  if (tag === 'textarea') return 'textbox';
  if (tag === 'select') return 'combobox';
  if (tag === 'button' || tag === 'summary') return 'button';
  if (tag === 'a') return 'link';
  if ((el as HTMLElement).isContentEditable) return 'textbox';
  return 'other';
}

function nearbyLabel(el: Element): string {
  let p: Element | null = el;
  for (let i = 0; i < 2 && p; i++) {
    const s = shortText(p.previousElementSibling);
    if (s) return s;
    p = p.parentElement;
  }
  return '';
}

function labelOf(el: Element, role: Role): string {
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const t = by.split(/\s+/).map((id) => textOf(document.getElementById(id))).join(' ').trim();
    if (t) return t;
  }
  const al = el.getAttribute('aria-label');
  if (al?.trim()) return al.trim();
  if (role === 'button' || role === 'link') {
    return (textOf(el) || (el as HTMLInputElement).value || el.getAttribute('title') || el.querySelector('img')?.getAttribute('alt') || '').trim().slice(0, 120);
  }
  const labels = (el as HTMLInputElement).labels;
  if (labels?.length) {
    const t = Array.from(labels).map((l) => textOf(l)).join(' ').trim();
    if (t) return t;
  }
  return nearbyLabel(el) || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || '';
}

function valueOf(el: Element, role: Role): { value: string; hasValue: boolean } {
  if (el instanceof HTMLInputElement) {
    if (role === 'password') return { value: '', hasValue: el.value.length > 0 };
    if (role === 'checkbox' || role === 'radio' || role === 'button') return { value: '', hasValue: false };
    return { value: el.value, hasValue: el.value.length > 0 };
  }
  if (el instanceof HTMLTextAreaElement) return { value: el.value.slice(0, 500), hasValue: el.value.length > 0 };
  if (el instanceof HTMLSelectElement) {
    const t = el.selectedOptions[0]?.text ?? '';
    return { value: t, hasValue: !!t };
  }
  if ((el as HTMLElement).isContentEditable) {
    const t = (el as HTMLElement).innerText.slice(0, 500);
    return { value: t, hasValue: !!t.trim() };
  }
  return { value: '', hasValue: false };
}

function contentBox(el: Element, r: DOMRect): BBox {
  const cs = getComputedStyle(el);
  const px = (v: string) => parseFloat(v) || 0;
  return [
    Math.round(r.left + px(cs.borderLeftWidth) + px(cs.paddingLeft) * 0.5),
    Math.round(r.top + px(cs.borderTopWidth)),
    Math.round(r.right - px(cs.borderRightWidth)),
    Math.round(r.bottom - px(cs.borderBottomWidth)),
  ];
}

function contextClassFor(p: Element, text: string) {
  // Labels, headings and controls are never values; a sibling holding a form control is a field, not a label.
  if (text.trim().length > 120 || p.closest('label,legend,button,a,h1,h2,h3,h4,h5,h6,th')) return undefined;
  const asLabel = (e: Element | null | undefined) => (e && !e.querySelector(INTERACTIVE) ? shortText(e) : '');
  const label = asLabel(p.previousElementSibling) || asLabel(p.parentElement?.previousElementSibling);
  if (!label || label.length > 40) return undefined;
  return classFromContext(label);
}

function rectsFor(nodes: { node: Text; start: number }[], start: number, end: number): BBox[] {
  const find = (off: number, isEnd: boolean) => {
    for (const n of nodes) {
      const len = n.node.length;
      if (isEnd ? off > n.start && off <= n.start + len : off >= n.start && off < n.start + len) return { node: n.node, off: off - n.start };
    }
    return null;
  };
  const a = find(start, false);
  const b = find(end, true);
  if (!a || !b) return [];
  const range = document.createRange();
  range.setStart(a.node, a.off);
  range.setEnd(b.node, b.off);
  return Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0).map(toBox);
}

function collectTexts(nextId: () => number, terms: Term[]): RawText[] {
  const groups = new Map<Element, { nodes: { node: Text; start: number }[]; text: string }>();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const p = n.parentElement;
      if (!p || !n.nodeValue?.trim()) return REJECT;
      return p.closest(NO_TEXT) ? REJECT : ACCEPT;
    },
  });
  while (w.nextNode()) {
    const n = w.currentNode as Text;
    const p = n.parentElement!;
    let g = groups.get(p);
    if (!g) groups.set(p, (g = { nodes: [], text: '' }));
    g.nodes.push({ node: n, start: g.text.length });
    g.text += n.nodeValue;
  }

  const out: RawText[] = [];
  for (const [p, g] of groups) {
    if (out.length >= 400) break;
    const range = document.createRange();
    const last = g.nodes[g.nodes.length - 1].node;
    range.setStart(g.nodes[0].node, 0);
    range.setEnd(last, last.length);
    const r = range.getBoundingClientRect();
    if (!isVisible(p, r)) continue;

    let spans: Span[] = mergeSpans(detectAll(g.text, terms), detectLabelValue(g.text));
    if (!spans.length) {
      const cls = contextClassFor(p, g.text);
      if (cls) {
        const s = g.text.search(/\S/);
        const e = g.text.trimEnd().length;
        spans = [{ cls, start: s, end: e, value: g.text.slice(s, e), layer: 'L4' }];
      }
    }
    out.push({
      vid: nextId(),
      text: g.text,
      bbox: toBox(r),
      spans: spans.map((s) => ({ ...s, rects: rectsFor(g.nodes, s.start, s.end) })),
    });
  }
  return out;
}

function snapshot(terms: Term[] = []): RawSnapshot {
  const t0 = performance.now();
  document.querySelectorAll('[data-veil-id]').forEach((e) => e.removeAttribute('data-veil-id'));
  registry = new Map();
  let next = 1;
  const nextId = () => next++;

  const elements: RawElement[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(INTERACTIVE)) {
    const r = el.getBoundingClientRect();
    if (!isVisible(el, r)) continue;
    const role = roleOf(el);
    const vid = nextId();
    el.setAttribute('data-veil-id', String(vid));
    registry.set(vid, el);
    const { value, hasValue } = valueOf(el, role);
    const input = el as HTMLInputElement;
    elements.push({
      vid,
      role,
      tag: el.tagName.toLowerCase(),
      type: (input.type || '').toLowerCase(),
      label: labelOf(el, role),
      value,
      hasValue,
      placeholder: el.getAttribute('placeholder') ?? '',
      name: el.getAttribute('name') ?? '',
      idAttr: el.id ?? '',
      autocomplete: el.getAttribute('autocomplete') ?? '',
      required: !!input.required,
      disabled: !!input.disabled,
      checked: role === 'checkbox' || role === 'radio' ? input.checked : undefined,
      options: el instanceof HTMLSelectElement ? Array.from(el.options).map((o) => o.text) : undefined,
      bbox: toBox(r),
      valueBox: contentBox(el, r),
    });
  }

  const rasters: RawRaster[] = [];
  for (const el of document.querySelectorAll(RASTER)) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'svg' && el.parentElement?.closest('svg')) continue;
    const r = el.getBoundingClientRect();
    const min = tag === 'svg' ? 96 : 48;
    if (r.width < min || r.height < min || !isVisible(el, r)) continue;
    const raster: RawRaster = { vid: nextId(), kind: tag, alt: el.getAttribute('alt') || el.getAttribute('aria-label') || el.getAttribute('title') || '', bbox: toBox(r) };
    if (el instanceof HTMLIFrameElement) {
      const cs = getComputedStyle(el);
      const x = r.left + el.clientLeft + (parseFloat(cs.paddingLeft) || 0);
      const y = r.top + el.clientTop + (parseFloat(cs.paddingTop) || 0);
      raster.src = el.src;
      raster.inner = [Math.round(x), Math.round(y), Math.round(x + el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)), Math.round(y + el.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0))];
    }
    rasters.push(raster);
  }

  return {
    url: location.href,
    title: document.title,
    viewport: [innerWidth, innerHeight],
    dpr: devicePixelRatio,
    elements,
    texts: collectTexts(nextId, terms),
    rasters,
    ms: Math.round(performance.now() - t0),
  };
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, v: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function highlight(el: HTMLElement) {
  const prev = el.style.outline;
  el.style.outline = '3px solid #F0B429';
  el.style.outlineOffset = '2px';
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  setTimeout(() => (el.style.outline = prev), 6000);
}

async function execute(a: ExecAction): Promise<ExecResult> {
  const target = 'target' in a && a.target != null ? registry.get(a.target) : undefined;
  if ('target' in a && a.target != null && !target && a.type !== 'ask_user') return { ok: false, error: `Element ${a.target} is gone` };

  switch (a.type) {
    case 'click': {
      const el = target!;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      await nextFrame();
      const r = el.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window };
      el.dispatchEvent(new PointerEvent('pointerdown', o));
      el.dispatchEvent(new MouseEvent('mousedown', o));
      el.focus?.();
      el.dispatchEvent(new PointerEvent('pointerup', o));
      el.dispatchEvent(new MouseEvent('mouseup', o));
      el.click();
      return { ok: true };
    }
    case 'type': {
      const el = target!;
      el.scrollIntoView({ block: 'center' });
      el.focus();
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) setNativeValue(el, a.text);
      else if (el.isContentEditable) {
        el.textContent = a.text;
        el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      } else return { ok: false, error: 'Target is not editable' };
      el.dispatchEvent(new Event('blur'));
      return { ok: true };
    }
    case 'select': {
      const el = target as HTMLSelectElement;
      const opt = Array.from(el.options).find((o) => o.text.trim() === a.option || o.value === a.option);
      if (!opt) return { ok: false, error: `No option “${a.option}”` };
      el.value = opt.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    }
    case 'scroll':
      window.scrollBy({ top: (a.direction === 'down' ? 1 : -1) * (a.amount ?? innerHeight * 0.8), behavior: 'instant' as ScrollBehavior });
      return { ok: true };
    case 'key': {
      const el = (target ?? document.activeElement ?? document.body) as HTMLElement;
      for (const type of ['keydown', 'keypress', 'keyup'])
        el.dispatchEvent(new KeyboardEvent(type, { key: a.key, bubbles: true, cancelable: true }));
      return { ok: true };
    }
    case 'ask_user':
      if (target) highlight(target);
      return { ok: true };
    case 'wait':
      await new Promise((r) => setTimeout(r, Math.min(a.ms, 5000)));
      return { ok: true };
    default:
      return { ok: true };
  }
}

function settle(quietMs = 300, maxMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    let timer = setTimeout(done, quietMs);
    const hard = setTimeout(done, maxMs);
    const mo = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(done, quietMs);
    });
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    function done() {
      mo.disconnect();
      clearTimeout(timer);
      clearTimeout(hard);
      resolve();
    }
  });
}

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    const w = window as unknown as { __veil?: boolean };
    if (w.__veil) return;
    w.__veil = true;
    browser.runtime.onMessage.addListener((msg: any, _sender: any, send: (r: unknown) => void) => {
      if (msg?.target !== 'content') return false;
      const reply = (p: Promise<unknown>) => {
        p.then(send, (e) => send({ ok: false, error: String(e) }));
        return true;
      };
      switch (msg.kind) {
        case 'ping': send({ ok: true }); return false;
        case 'snapshot': return reply(Promise.resolve().then(() => snapshot(msg.terms ?? [])));
        case 'exec': return reply(execute(msg.action));
        case 'settle': return reply(settle().then(() => ({ ok: true })));
        default: return false;
      }
    });
  },
});

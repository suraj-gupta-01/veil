import { Vault } from '@/lib/vault';
import { collapse, rasterKey, sanitize, sanitizeText } from '@/lib/sanitize';
import { egressFetch, firewall } from '@/lib/egress';
import { composite } from '@/lib/redact';
import { decide } from '@/lib/policy';
import { classFromContext } from '@/lib/pii/rules';
import { emit, listen } from '@/lib/runtime';
import { getSettings, setSettings, type Settings } from '@/lib/settings';
import { VRS_VERSION, tokensIn, type Action, type SessionResponse, type StepRequest, type StepResponse } from '@/lib/vrs';
import type { CompositeRequest, CompositeResult, ExecResult, PanelRequest, RawSnapshot, Timings } from '@/lib/messages';
import type { Sanitized } from '@/lib/sanitize';
import type { RasterVision, VisionRequest, VisionResult } from '@/lib/vision';
import type { Name } from '@/lib/pii/ner';
import { matchFrames, mergeFrames, type FrameInfo, type Route } from '@/lib/frames';

interface Task {
  goal: string;
  review: boolean;
  structureOnly: boolean;
  tabId: number;
  origin: string;
  allowedOrigins: Set<string>;
  session?: SessionResponse;
  step: number;
  history: { step: number; summary: string }[];
  stopped: boolean;
}

interface Perception {
  raw: RawSnapshot;
  rawImage: string;
  san: Sanitized;
  /** Elements that live in a child frame: page-level id to the frame and its own id. */
  routes: Map<number, Route>;
  vision?: VisionResult;
  comp: CompositeResult;
  timings: Timings;
}

const MAX_STEPS = 12;
// NER needs sentence context: on lone labels ("Aadhaar", "3. Done") it guesses PER for capitalised words.
const NAME_LIKE = /\p{Lu}\p{Ll}+/u;
const WORD = /\p{L}{2,}/gu;
const NER_CHARS = 8000;

export default defineBackground(() => {
  let vault = new Vault();
  let task: Task | null = null;
  const pending = new Map<string, (ok: boolean) => void>();

  const ready = browser.storage.session.get('vault').then((s) => {
    const v = Vault.restore(s.vault as string | undefined);
    if (!v.expired()) vault = v;
  });
  const persist = () => browser.storage.session.set({ vault: vault.serialize() });

  const chromeApi = (globalThis as any).chrome;
  chromeApi?.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
  if (!chromeApi?.sidePanel && (browser as any).sidebarAction) {
    browser.action.onClicked.addListener(() => (browser as any).sidebarAction.open());
  }

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'veil-panel') return;
    port.onMessage.addListener(() => {});
  });

  browser.commands?.onCommand.addListener((cmd) => {
    if (cmd === 'stop-agent') stop('Stopped from keyboard shortcut.');
  });

  const log = (level: 'info' | 'warn' | 'error' | 'ok', text: string) => emit({ kind: 'log', level, text });
  const status = (running: boolean, text: string) => emit({ kind: 'status', running, text });

  function ask(title: string, detail: string, approve = 'Approve', reject = 'Stop'): Promise<boolean> {
    const id = crypto.randomUUID();
    emit({ kind: 'approval', id, title, detail, approve, reject });
    return new Promise((res) => pending.set(id, (ok) => { emit({ kind: 'approval-closed', id }); res(ok); }));
  }

  async function activeTab() {
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) throw new Error('Open a regular web page (http or https) first.');
    return tab;
  }

  async function toContent<T>(tabId: number, msg: object, frameId = 0): Promise<T> {
    const send = () => browser.tabs.sendMessage(tabId, { target: 'content', ...msg }, { frameId }) as Promise<T>;
    try {
      return await send();
    } catch {
      await browser.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ['/content-scripts/content.js'] });
      return await send();
    }
  }

  /** Top frame plus every direct child frame that can be matched to its <iframe>; the rest stay rasters. */
  async function snapshotTab(tabId: number): Promise<{ raw: RawSnapshot; routes: Map<number, Route> }> {
    const terms = vault.dictionary();
    const top = await toContent<RawSnapshot>(tabId, { kind: 'snapshot', terms });
    if (!top.rasters.some((r) => r.kind === 'iframe')) return { raw: top, routes: new Map() };
    const probe = await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => ({ url: location.href, size: [innerWidth, innerHeight] as [number, number], child: window !== window.top && window.parent === window.top }),
    }).catch(() => []);
    const frames: FrameInfo[] = probe
      .filter((p) => p.frameId && p.result?.child)
      .map((p) => ({ frameId: p.frameId, url: p.result!.url, size: p.result!.size }));
    const children = [];
    for (const { frame, raster } of matchFrames(top, frames)) {
      const snap = await toContent<RawSnapshot>(tabId, { kind: 'snapshot', terms }, frame.frameId).catch(() => null);
      if (snap) children.push({ frameId: frame.frameId, url: frame.url, raster, snap });
    }
    return mergeFrames(top, children);
  }

  // The perception page runs models and pixel work. Chrome hosts it as an offscreen document; Firefox's
  // background page has a DOM, so it hosts the same page in a hidden iframe.
  async function viaOffscreen<T>(msg: object): Promise<T> {
    const url = browser.runtime.getURL('/offscreen.html');
    if (import.meta.env.FIREFOX) {
      if (!document.querySelector('iframe[data-veil-perception]')) {
        const f = Object.assign(document.createElement('iframe'), { src: url });
        f.dataset.veilPerception = '';
        const loaded = new Promise((r) => (f.onload = r));
        document.body.append(f);
        await loaded;
      }
    } else {
      const has = await chromeApi.runtime.getContexts?.({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
      if (!has?.length) await chromeApi.offscreen.createDocument({ url, reasons: ['BLOBS', 'WORKERS'], justification: 'Read and redact screenshots locally before upload' });
    }
    const r = await browser.runtime.sendMessage({ target: 'offscreen', ...msg });
    if (r?.__error) throw new Error(r.__error);
    return r as T;
  }

  async function compositeAnywhere(req: CompositeRequest): Promise<CompositeResult> {
    if (typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined') {
      try { return await composite(req); } catch (e) { if (!chromeApi?.offscreen) throw e; }
    }
    return viaOffscreen({ kind: 'composite', req });
  }

  const see = (req: VisionRequest) => viaOffscreen<VisionResult>({ kind: 'vision', req });

  // L2: names in free text (DOM text, unclassified field values, text read from images) join the vault as NAME,
  // so the dictionary pass masks them wherever they appear, with exact rects after the re-snapshot.
  async function learnNames(raw: RawSnapshot, vision: VisionResult | undefined, source: string, timings: Timings) {
    const texts = [
      ...raw.texts.map((t) => t.text),
      ...raw.elements.filter((e) => e.value && e.role !== 'password').map((e) => e.value),
      ...(vision?.rasters.flatMap((r) => r.lines.map((l) => l.text)) ?? []),
    ].filter((t) => NAME_LIKE.test(t) && (t.match(WORD) ?? []).length >= 4);
    const batch: string[] = [];
    let chars = 0;
    for (const t of texts) {
      if (chars >= NER_CHARS) break;
      batch.push(t);
      chars += t.length;
    }
    if (!batch.length) return;
    try {
      const found = await timed(timings, 'ner', () => viaOffscreen<Name[]>({ kind: 'ner', texts: batch }));
      const fresh = found.filter((n) => n.value.trim().length >= 3 && !classFromContext(n.value) && !vault.dictionary().some((t) => t.term.toLowerCase() === n.value.trim().toLowerCase()));
      for (const n of fresh) vault.tokenFor('NAME', n.value.trim(), source);
      if (fresh.length) log('info', `NER found ${fresh.length} name(s) in free text.`);
    } catch (e) {
      log('warn', `NER unavailable; names in free text rely on labels and the vault: ${(e as Error).message ?? e}`);
    }
  }

  async function readImages(raw: RawSnapshot, image: string, timings: Timings): Promise<VisionResult | undefined> {
    if (!raw.rasters.length) return undefined;
    const req = { image, viewport: raw.viewport, rasters: raw.rasters.map((r) => ({ key: rasterKey(r), bbox: r.bbox })) };
    try {
      const v = await timed(timings, 'vision', () => see(req));
      const ok = v.rasters.filter((r) => r.ok);
      const count = (f: (r: RasterVision) => number) => ok.reduce((n, r) => n + f(r), 0);
      const whole = v.rasters.length - ok.length;
      log(whole ? 'warn' : 'info', `Vision on ${v.backend}: read ${ok.length} image(s), ${count((r) => r.faces.length)} face(s), ${count((r) => r.codes.length)} code(s), ${count((r) => r.lines.length)} text line(s)` +
        (whole ? `; ${whole} masked whole (${v.rasters.find((r) => !r.ok)?.error}).` : '.'));
      return v;
    } catch (e) {
      log('warn', `Vision unavailable, so every image is masked whole: ${(e as Error).message ?? e}`);
      return undefined;
    }
  }

  const timed = async <T>(t: Timings, key: string, fn: () => Promise<T> | T): Promise<T> => {
    const t0 = performance.now();
    try { return await fn(); } finally { t[key] = Math.round(performance.now() - t0); }
  };

  async function perceive(tabId: number, windowId: number): Promise<Perception> {
    await ready;
    for (const term of (await getSettings()).terms) vault.tokenFor('CUSTOM', term, 'user');
    const timings: Timings = {};
    let [{ raw, routes }, rawImage] = await Promise.all([
      timed(timings, 'snapshot', () => snapshotTab(tabId)),
      // PNG, not JPEG: compression artefacts make OCR merge words and misread digits.
      timed(timings, 'capture', () => browser.tabs.captureVisibleTab(windowId, { format: 'png' })),
    ]);
    const source = new URL(raw.url).origin;
    const vision = await readImages(raw, rawImage, timings);
    const seen = new Map(vision?.rasters.map((v) => [v.key, v]));
    await learnNames(raw, vision, source, timings);
    let san = await timed(timings, 'sanitize', () => sanitize(raw, vault, source, seen));
    if (san.needsResnap) {
      ({ raw, routes } = await timed(timings, 'resnap', () => snapshotTab(tabId)));
      san = sanitize(raw, vault, source, seen);
    }
    const comp = await timed(timings, 'redact', () =>
      compositeAnywhere({ image: rawImage, viewport: raw.viewport, masks: san.masks, marks: san.marks, maxSide: 1280 }),
    );
    await persist();
    return { raw, rawImage, san, routes, vision, comp, timings };
  }

  function buildRequest(p: Perception, t: Task): StepRequest {
    const mode = t.structureOnly ? 'structure' : 'pixel';
    return {
      session_id: t.session!.session_id,
      vrs_version: VRS_VERSION,
      goal: sanitizeText(t.goal, vault, 'goal').text,
      step: t.step,
      mode,
      screen: { ...p.san.screen, image: mode === 'pixel' ? p.comp.image : undefined },
      entities: vault.entities(),
      history: t.history.slice(-8),
    };
  }

  function showLens(step: number, p: Perception, req: StepRequest | null, fw: ReturnType<typeof firewall> | null) {
    const { image, ...screen } = req?.screen ?? { ...p.san.screen, image: p.comp.image };
    const payload = req
      ? { ...req, screen }
      : { session_id: '(preview)', vrs_version: VRS_VERSION, goal: '', step, mode: 'pixel' as const, screen, entities: vault.entities(), history: [] };
    emit({
      kind: 'lens',
      step,
      rawImage: p.rawImage,
      sentImage: req ? image : p.comp.image,
      payload,
      tokens: vault.entities().map((e) => ({ token: e.token, cls: e.class })),
      timings: p.timings,
      firewall: fw ?? { ok: p.comp.integrity, checks: [{ name: 'Mask integrity', ok: p.comp.integrity }, { name: 'Preview only', ok: true, detail: 'Nothing was sent' }] },
      bytes: p.comp.bytes,
    });
  }

  async function scan() {
    const tab = await activeTab();
    status(true, 'Scanning');
    const p = await perceive(tab.id!, tab.windowId!);
    showLens(0, p, null, null);
    log('info', `Scanned ${new URL(p.raw.url).host}: ${p.san.masks.length} regions masked, ${vault.size} placeholders in vault.`);
    status(false, 'Idle');
  }

  async function api<T>(path: string, body: unknown, bearer?: string): Promise<T> {
    const { serverUrl } = await getSettings();
    const res = await egressFetch(new URL(path, serverUrl).href, serverUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(res.status === 422 ? `Server guard rejected the payload: ${detail}` : `Server ${res.status}: ${detail}`);
    }
    return res.json() as Promise<T>;
  }

  async function run(goal: string, review: boolean, structureOnly: boolean) {
    if (task && !task.stopped) throw new Error('A task is already running.');
    const tab = await activeTab();
    const origin = new URL(tab.url!).origin;
    task = { goal, review, structureOnly, tabId: tab.id!, origin, allowedOrigins: new Set([origin]), step: 0, history: [], stopped: false };
    const t = task;
    status(true, 'Starting');
    t.session = await api<SessionResponse>('/v1/session', { client: 'veil-extension', vrs_version: VRS_VERSION });
    log('info', `Session ${t.session.session_id} opened.`);
    const { serverUrl } = await getSettings();

    while (!t.stopped && t.step < Math.min(MAX_STEPS, t.session.max_steps)) {
      t.step++;
      status(true, `Step ${t.step}: reading the page`);
      const cur = await browser.tabs.get(t.tabId);
      if (!cur.active) {
        const ok = await ask('Switch back to the task tab', 'VEIL can only read the tab that is visible.', 'I switched back', 'Stop');
        if (!ok) return stop('Stopped.');
      }
      const p = await perceive(t.tabId, cur.windowId!);
      const req = buildRequest(p, t);
      const dest = new URL('/v1/step', serverUrl).href;
      const readBack = req.screen.image && (await getSettings()).paranoid
        ? await timed(p.timings, 'audit', () => viaOffscreen<string[]>({ kind: 'audit', image: req.screen.image }).catch(() => null))
        : undefined;
      const fw = await timed(p.timings, 'firewall', () => firewall(req, vault, dest, serverUrl, p.comp.integrity, readBack));
      showLens(t.step, p, req, fw);

      if (!fw.ok) {
        const failed = fw.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail ?? 'failed'}`).join('; ');
        log('error', `Egress firewall blocked step ${t.step}. ${failed}`);
        return stop('Blocked by the egress firewall. Nothing was sent.');
      }
      if (t.review && !(await ask(`Send step ${t.step} to the server?`, `The privacy lens shows exactly what will be sent (${Math.round(p.comp.bytes / 1024)} KB image).`, 'Send', 'Stop'))) {
        return stop('Stopped before sending.');
      }

      status(true, `Step ${t.step}: planning`);
      const res = await timed(p.timings, 'server', () => api<StepResponse>('/v1/step', req, t.session!.token));
      showLens(t.step, p, req, fw);
      log('info', `Plan: ${res.rationale}`);

      const t0 = performance.now();
      for (const a of res.actions) {
        if (t.stopped) return;
        if (!(await act(a, p, t))) return;
      }
      p.timings.execute = Math.round(performance.now() - t0);
      t.history.push({ step: t.step, summary: res.rationale });

      if (res.done || res.actions.some((a) => a.type === 'done')) {
        const done = res.actions.find((a): a is Extract<Action, { type: 'done' }> => a.type === 'done');
        log('ok', done?.message ?? 'Task complete.');
        return stop('Done.', true);
      }
      await toContent(t.tabId, { kind: 'settle' }).catch(() => {});
    }
    if (!t.stopped) stop(`Reached the ${MAX_STEPS}-step limit.`);
  }

  async function act(a: Action, p: Perception, t: Task): Promise<boolean> {
    const target = 'target' in a ? a.target : undefined;
    const label = target != null ? p.san.labels.get(target) ?? '' : '';
    const describe = () => a.type === 'type' ? `Type ${tokensIn(a.text).join(' ') || '(text)'} into “${label}”` : a.type === 'click' ? `Click “${label}”` : a.type;

    // Actions on elements inside a child frame go to that frame, with its own id; the policy checks its origin.
    const route = target != null ? p.routes.get(target) : undefined;
    const exec = <T>(action: Action) => toContent<T>(t.tabId, { kind: 'exec', action: route ? { ...action, target: route.vid } : action }, route?.frameId ?? 0);

    if (a.type === 'done') return true;
    if (a.type === 'ask_user') {
      await exec(a);
      const ok = await ask('Your turn', a.message, 'Done, continue', 'Stop');
      if (!ok) { stop('Stopped.'); return false; }
      return true;
    }

    const cur = await browser.tabs.get(t.tabId);
    const v = decide(a, {
      vault,
      fieldClass: target != null ? p.san.fieldClasses.get(target) : undefined,
      label,
      origin: route?.origin ?? new URL(cur.url ?? 'about:blank').origin,
      allowedOrigins: t.allowedOrigins,
    });
    if (v.verdict === 'deny') {
      log('warn', `Skipped: ${describe()}. ${v.reason}`);
      return true;
    }
    if (v.verdict === 'confirm' && !(await ask('Confirm action', v.reason, 'Allow', 'Stop'))) {
      stop('Stopped at a confirmation.');
      return false;
    }

    const action = a.type === 'type' ? { ...a, text: vault.rehydrate(a.text) } : a;
    const r = await exec<ExecResult>(action);
    log(r.ok ? 'ok' : 'warn', r.ok ? describe() : `${describe()} failed: ${r.error}`);
    await new Promise((res) => setTimeout(res, 120));
    return true;
  }

  function stop(reason: string, keepVault = false) {
    const t = task;
    if (t) {
      t.stopped = true;
      if (t.session) getSettings().then(({ serverUrl }) =>
        egressFetch(new URL(`/v1/session/${t.session!.session_id}`, serverUrl).href, serverUrl, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${t.session!.token}` },
        }).catch(() => {}),
      );
    }
    for (const [, resolve] of pending) resolve(false);
    pending.clear();
    if (!keepVault) { vault.clear(); persist(); }
    task = null;
    status(false, reason);
    log('info', keepVault ? reason : `${reason} Vault wiped.`);
  }

  listen('bg', (msg: PanelRequest) => {
    switch (msg.kind) {
      case 'scan':
        return scan().then(() => ({ ok: true }), (e) => { status(false, 'Idle'); log('error', String(e.message ?? e)); return { ok: false }; });
      case 'start':
        run(collapse(msg.goal), msg.review, msg.structureOnly).catch((e) => { log('error', String(e.message ?? e)); stop('Stopped after an error.'); });
        return { ok: true };
      case 'stop':
        stop('Stopped.');
        return { ok: true };
      case 'approve':
        pending.get(msg.id)?.(msg.ok);
        pending.delete(msg.id);
        return { ok: true };
      case 'reveal':
        return { value: vault.get(msg.token)?.value || '(secret: never stored)' };
      case 'wipe':
        vault.clear();
        persist();
        log('info', 'Vault wiped.');
        return { ok: true };
    }
  });

  listen('settings', (msg: { kind: 'get' } | ({ kind: 'set' } & Settings)) =>
    msg.kind === 'get' ? getSettings() : setSettings({ serverUrl: msg.serverUrl, terms: msg.terms, paranoid: msg.paranoid }).then(() => ({ ok: true })),
  );
});

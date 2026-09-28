import { call } from '@/lib/runtime';
import type { PanelEvent } from '@/lib/messages';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const goal = $<HTMLTextAreaElement>('goal');
const scanBtn = $<HTMLButtonElement>('scan');
const startBtn = $<HTMLButtonElement>('start');
const stopBtn = $<HTMLButtonElement>('stop');
const review = $<HTMLInputElement>('review');
const structure = $<HTMLInputElement>('structure');
const statusEl = $('status');
const frame = $<HTMLImageElement>('frame');
const frameEmpty = $('frame-empty');
const fwList = $('firewall');
const tokensEl = $('tokens');
const timingsEl = $('timings');
const payloadEl = $('payload');
const logEl = $('log');
const approval = $('approval');
const server = $<HTMLInputElement>('server');

let view: 'sent' | 'raw' = 'sent';
let images = { raw: '', sent: '' };
let approvalId = '';

const port = browser.runtime.connect({ name: 'veil-panel' });
setInterval(() => port.postMessage({ ping: Date.now() }), 20_000);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

function setRunning(running: boolean, text: string) {
  statusEl.textContent = text;
  statusEl.classList.toggle('running', running);
  startBtn.disabled = running;
  scanBtn.disabled = running;
  stopBtn.disabled = !running;
}

function renderFrame() {
  const src = images[view];
  frame.hidden = !src;
  frameEmpty.hidden = !!src;
  if (src) {
    frame.src = src;
    frame.alt = view === 'sent' ? 'Redacted frame that is sent to the server' : 'Raw frame, kept on this device';
  }
}

function addLog(level: string, text: string) {
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  logEl.prepend(el('li', { className: level }, el('time', { textContent: now }), text));
  while (logEl.children.length > 60) logEl.lastElementChild?.remove();
}

const TIMING_LABELS: Record<string, string> = {
  capture: 'Capture', snapshot: 'DOM', vision: 'Vision', sanitize: 'Detect', redact: 'Redact', firewall: 'Firewall', server: 'Server', execute: 'Execute',
};

function renderLens(e: Extract<PanelEvent, { kind: 'lens' }>) {
  images = { raw: e.rawImage, sent: e.sentImage ?? '' };
  renderFrame();

  fwList.replaceChildren(
    ...e.firewall.checks.map((c) => el('li', { className: c.ok ? '' : 'bad' }, `${c.name} `, el('span', { textContent: c.detail ?? '' }))),
  );

  tokensEl.replaceChildren(
    ...e.tokens.map((t) => {
      const b = el('button', { className: 'tok', type: 'button', textContent: t.token, title: `${t.cls}. Click to reveal locally.` });
      b.addEventListener('click', async () => {
        const r = await call<{ value: string }>({ target: 'bg', kind: 'reveal', token: t.token });
        b.textContent = r.value;
        b.classList.add('revealed');
        setTimeout(() => { b.textContent = t.token; b.classList.remove('revealed'); }, 3000);
      });
      return b;
    }),
  );

  const total = Object.values(e.timings).reduce((a, b) => a + b, 0);
  timingsEl.replaceChildren(
    ...Object.entries(e.timings).map(([k, v]) => el('span', {}, `${TIMING_LABELS[k] ?? k} `, el('b', { textContent: `${v} ms` }))),
    el('span', {}, 'Total ', el('b', { textContent: `${total} ms` })),
    el('span', {}, 'Image ', el('b', { textContent: `${Math.round(e.bytes / 1024)} KB` })),
  );
  payloadEl.textContent = JSON.stringify(e.payload, null, 2);
}

browser.runtime.onMessage.addListener((msg: any) => {
  if (msg?.target !== 'panel') return false;
  const e = msg as PanelEvent;
  switch (e.kind) {
    case 'status': setRunning(e.running, e.text); break;
    case 'log': addLog(e.level, e.text); break;
    case 'lens': renderLens(e); break;
    case 'approval':
      approvalId = e.id;
      $('ap-title').textContent = e.title;
      $('ap-detail').textContent = e.detail;
      $('ap-yes').textContent = e.approve;
      $('ap-no').textContent = e.reject;
      approval.hidden = false;
      $<HTMLButtonElement>('ap-yes').focus();
      break;
    case 'approval-closed':
      if (e.id === approvalId) approval.hidden = true;
      break;
  }
  return false;
});

const answer = (ok: boolean) => {
  if (!approvalId) return;
  call({ target: 'bg', kind: 'approve', id: approvalId, ok });
  approval.hidden = true;
  approvalId = '';
};
$('ap-yes').addEventListener('click', () => answer(true));
$('ap-no').addEventListener('click', () => answer(false));

document.querySelectorAll<HTMLButtonElement>('.seg button').forEach((b) =>
  b.addEventListener('click', () => {
    view = b.dataset.view as 'sent' | 'raw';
    document.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    renderFrame();
  }),
);

scanBtn.addEventListener('click', () => call({ target: 'bg', kind: 'scan' }));
startBtn.addEventListener('click', () => {
  if (!goal.value.trim()) { goal.focus(); addLog('warn', 'Describe the task first.'); return; }
  setRunning(true, 'Starting');
  call({ target: 'bg', kind: 'start', goal: goal.value, review: review.checked, structureOnly: structure.checked });
});
stopBtn.addEventListener('click', () => call({ target: 'bg', kind: 'stop' }));
$('wipe').addEventListener('click', () => { call({ target: 'bg', kind: 'wipe' }); tokensEl.replaceChildren(); });

call<{ serverUrl: string }>({ target: 'settings', kind: 'get' }).then((s) => (server.value = s.serverUrl));
$('save').addEventListener('click', () =>
  call({ target: 'settings', kind: 'set', serverUrl: server.value.trim() }).then(() => addLog('ok', `Server set to ${server.value.trim()}.`)),
);

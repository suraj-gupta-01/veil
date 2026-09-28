import type { FirewallCheck, FirewallResult } from './messages';
import { TOKEN_RE, type StepRequest } from './vrs';
import { detectPatterns } from './pii/rules';
import { digitsOf } from './pii/validators';
import type { Entry, Vault } from './vault';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function strings(obj: unknown, skip = new Set(['image']), out: string[] = []): string[] {
  if (typeof obj === 'string') out.push(obj);
  else if (Array.isArray(obj)) obj.forEach((v) => strings(v, skip, out));
  else if (obj && typeof obj === 'object')
    for (const [k, v] of Object.entries(obj)) if (!skip.has(k)) strings(v, skip, out);
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function valuePatterns(e: Entry): RegExp[] {
  const v = e.value.trim();
  const digits = digitsOf(v);
  if (digits.length >= 6 && digits.length / v.replace(/\s/g, '').length > 0.6) {
    const core = e.cls === 'PHONE' ? digits.slice(-10) : digits;
    return [new RegExp(core.split('').join('[\\s-]?'))];
  }
  const pats: RegExp[] = [];
  if (v.length >= 3) pats.push(new RegExp(escapeRe(v).replace(/\s+/g, '\\s+'), 'i'));
  if (e.cls === 'NAME')
    for (const w of v.split(/\s+/)) if (w.length >= 3) pats.push(new RegExp(`\\b${escapeRe(w)}\\b`, 'i'));
  return pats;
}

export function destinationAllowed(dest: string, serverUrl: string): boolean {
  try {
    const d = new URL(dest);
    const s = new URL(serverUrl);
    return d.origin === s.origin && (d.protocol === 'https:' || LOCAL_HOSTS.has(d.hostname));
  } catch {
    return false;
  }
}

const leakedValues = (text: string, vault: Vault) => vault.values().filter((e) => valuePatterns(e).some((re) => re.test(text)));

/**
 * `audit` is the text OCR read back from the outgoing image in paranoid mode: undefined when the audit is off,
 * null when it failed (which blocks, since the image could not be checked).
 */
export function firewall(req: StepRequest, vault: Vault, dest: string, serverUrl: string, integrity: boolean, audit?: string[] | null): FirewallResult {
  const checks: FirewallCheck[] = [];
  checks.push({ name: 'Destination', ok: destinationAllowed(dest, serverUrl), detail: new URL(dest).origin });

  const text = strings(req).join('\n').replace(TOKEN_RE, ' ');
  const leaked = leakedValues(text, vault);
  checks.push({
    name: 'Vault match',
    ok: leaked.length === 0,
    detail: leaked.length ? `Raw values for ${leaked.map((e) => e.token).join(', ')}` : `${vault.values().length} values checked`,
  });

  const patterns = detectPatterns(text);
  checks.push({
    name: 'Pattern re-scan',
    ok: patterns.length === 0,
    detail: patterns.length ? `Untokenized ${[...new Set(patterns.map((p) => p.cls))].join(', ')}` : 'No raw identifiers',
  });

  if (req.mode === 'pixel') {
    checks.push({ name: 'Mask integrity', ok: integrity && !!req.screen.image, detail: integrity ? 'All masks opaque' : 'A mask failed verification' });
  } else {
    checks.push({ name: 'No image in structure mode', ok: !req.screen.image });
  }
  if (audit === null) checks.push({ name: 'OCR audit', ok: false, detail: 'Could not read back the outgoing image' });
  else if (audit) {
    const seen = audit.join('\n');
    const found = [...leakedValues(seen, vault).map((e) => e.token), ...new Set(detectPatterns(seen).map((p) => p.cls))];
    checks.push({ name: 'OCR audit', ok: !found.length, detail: found.length ? `Readable in the image: ${found.join(', ')}` : `${audit.length} text lines read back, none sensitive` });
  }
  return { ok: checks.every((c) => c.ok), checks };
}

export async function egressFetch(dest: string, serverUrl: string, init: RequestInit): Promise<Response> {
  if (!destinationAllowed(dest, serverUrl)) throw new Error(`Egress blocked: ${dest} is not the configured server`);
  return fetch(dest, { ...init, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
}

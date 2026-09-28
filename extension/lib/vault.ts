import { GROUP, TOKEN_RE, makeToken, type TokenClass, type VEntity } from './vrs';
import { formatHint, normalizeValue } from './pii/validators';
import type { Term } from './pii/rules';

const DICT_CLASSES = new Set<TokenClass>(['NAME', 'EMAIL', 'ADDRESS', 'USERNAME', 'DOB', 'UPI', 'CUSTOM']);

export interface Entry {
  token: string;
  cls: TokenClass;
  value: string;
  source: string;
  valid?: boolean;
}

export const VAULT_TTL_MS = 15 * 60 * 1000;
/** Classes whose token stands for something VEIL never stores or types: a secret, or a region of pixels. */
const NO_VALUE = new Set<TokenClass>(['SECRET', 'FACE', 'SIGNATURE', 'QR', 'IMAGE']);

export class Vault {
  private byKey = new Map<string, Entry>();
  private byToken = new Map<string, Entry>();
  private counters: Partial<Record<TokenClass, number>> = {};
  lastUsed = Date.now();

  tokenFor(cls: TokenClass, value: string, source: string, valid?: boolean): string {
    const key = NO_VALUE.has(cls) ? `${cls}|${value}` : normalizeValue(cls, value);
    const hit = this.byKey.get(key);
    if (hit) { this.touch(); return hit.token; }
    const n = (this.counters[cls] ?? 0) + 1;
    this.counters[cls] = n;
    const e: Entry = { token: makeToken(cls, n), cls, value: NO_VALUE.has(cls) ? '' : value, source, valid };
    this.byKey.set(key, e);
    this.byToken.set(e.token, e);
    this.touch();
    return e.token;
  }

  secretFor(slot: string, source: string): string {
    return this.tokenFor('SECRET', slot, source);
  }

  get(token: string): Entry | undefined { return this.byToken.get(token); }
  get size() { return this.byToken.size; }
  touch() { this.lastUsed = Date.now(); }
  expired(now = Date.now()) { return now - this.lastUsed > VAULT_TTL_MS; }

  entities(): VEntity[] {
    return [...this.byToken.values()].map((e) => ({
      token: e.token,
      class: e.cls,
      group: GROUP[e.cls],
      format: e.value ? formatHint(e.cls, e.value) : undefined,
      valid_checksum: e.valid,
      source: e.source,
    }));
  }

  values(): Entry[] { return [...this.byToken.values()].filter((e) => e.value); }

  dictionary(): Term[] {
    const terms: Term[] = [];
    for (const e of this.values()) {
      if (!DICT_CLASSES.has(e.cls)) continue;
      const v = e.value.trim();
      if (v.length >= 3) terms.push({ term: v, cls: e.cls, token: e.token });
      if (e.cls === 'NAME') for (const w of v.split(/\s+/)) if (w.length >= 3 && w !== v) terms.push({ term: w, cls: 'NAME', token: e.token });
    }
    return terms;
  }

  rehydrate(text: string): string {
    return text.replace(TOKEN_RE, (t) => this.byToken.get(t)?.value || t);
  }

  clear() {
    this.byKey.clear();
    this.byToken.clear();
    this.counters = {};
  }

  serialize(): string {
    return JSON.stringify({ e: [...this.byKey.entries()], c: this.counters, t: this.lastUsed });
  }

  static restore(raw: string | undefined): Vault {
    const v = new Vault();
    if (!raw) return v;
    const { e, c, t } = JSON.parse(raw) as { e: [string, Entry][]; c: Vault['counters']; t: number };
    for (const [k, entry] of e) { v.byKey.set(k, entry); v.byToken.set(entry.token, entry); }
    v.counters = c;
    v.lastUsed = t;
    return v;
  }
}

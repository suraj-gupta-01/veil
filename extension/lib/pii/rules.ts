import type { TokenClass } from '../vrs';
import { digitsOf, luhn, verhoeff } from './validators';

export interface Span {
  cls: TokenClass;
  start: number;
  end: number;
  value: string;
  valid?: boolean;
  token?: string;
  layer: 'L0' | 'L1' | 'L4';
}

interface Detector {
  cls: TokenClass;
  re: RegExp;
  check?: (m: string) => boolean | 'reject';
}

const DETECTORS: Detector[] = [
  { cls: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  {
    cls: 'CARD',
    re: /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g,
    check: (m) => { const d = digitsOf(m); return d.length >= 13 && d.length <= 19 && luhn(d) ? true : 'reject'; },
  },
  {
    cls: 'AADHAAR',
    re: /(?<!\d)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?!\d)/g,
    check: (m) => { const ok = verhoeff(m); return ok || /[ -]/.test(m) ? ok : 'reject'; },
  },
  { cls: 'PAN', re: /\b[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]\b/g },
  { cls: 'IFSC', re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
  { cls: 'UPI', re: /\b[A-Za-z0-9._-]{2,64}@[A-Za-z]{2,32}\b(?![.@\w])/g },
  { cls: 'PHONE', re: /(?<![\d+])(?:\+?91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?!\d)/g },
];

export function mergeSpans(...lists: Span[][]): Span[] {
  const out: Span[] = [];
  for (const s of lists.flat()) {
    if (out.some((o) => s.start < o.end && o.start < s.end)) continue;
    out.push(s);
  }
  return out.sort((a, b) => a.start - b.start);
}

export function detectPatterns(text: string): Span[] {
  if (!text) return [];
  const found: Span[] = [];
  for (const d of DETECTORS) {
    d.re.lastIndex = 0;
    for (const m of text.matchAll(d.re)) {
      const verdict = d.check ? d.check(m[0]) : true;
      if (verdict === 'reject') continue;
      found.push({ cls: d.cls, start: m.index!, end: m.index! + m[0].length, value: m[0], valid: d.check ? verdict === true : undefined, layer: 'L1' });
    }
  }
  return mergeSpans(found);
}

const CONTEXT_RULES: [RegExp, TokenClass][] = [
  [/\b(pass ?word|passcode|passphrase)\b/, 'SECRET'],
  [/\b(otp|one[- ]time)\b/, 'SECRET'],
  [/\b(cvv|cvc|csc|security code)\b/, 'SECRET'],
  [/\b(pin ?code|postal|zip|address|street|locality|landmark)\b/, 'ADDRESS'],
  [/\b(m?pin|upi pin|atm pin)\b/, 'SECRET'],
  [/\b(aadhaa?r|aadhar|uidai|uid)\b/, 'AADHAAR'],
  [/\bpan\b|permanent account/, 'PAN'],
  [/\bpassport\b/, 'PASSPORT'],
  [/\b(voter|epic)\b/, 'VOTER_ID'],
  [/\b(card number|card no|credit card|debit card|cc-number)\b/, 'CARD'],
  [/\b(account (no|number|#)|a\/c|acct)\b/, 'ACCOUNT'],
  [/\bifsc\b/, 'IFSC'],
  [/\b(upi|vpa)\b/, 'UPI'],
  [/\b(e-?mail)\b/, 'EMAIL'],
  [/\b(phone|mobile|contact number|tel|whatsapp)\b/, 'PHONE'],
  [/\b(user ?name|user id|login id)\b/, 'USERNAME'],
  [/\b(dob|d\.o\.b|date of birth|birth ?date|born)\b/, 'DOB'],
  [/\b(full name|first name|last name|middle name|surname|given name|family name|father'?s name|mother'?s name|spouse|nominee|holder|applicant|name)\b/, 'NAME'],
];

function matchRules(rules: [RegExp, TokenClass][], parts: (string | null | undefined)[]): TokenClass | undefined {
  const s = parts.filter(Boolean).join(' ').toLowerCase().replace(/[_-]+/g, ' ');
  if (!s.trim()) return undefined;
  for (const [re, cls] of rules) if (re.test(s)) return cls;
  return undefined;
}

export const classFromContext = (...parts: (string | null | undefined)[]) => matchRules(CONTEXT_RULES, parts);

// OCR often drops the space between words ("Dateof birth"), so labels read from pixels match with optional spaces.
const LOOSE_RULES = CONTEXT_RULES.map(([re, cls]): [RegExp, TokenClass] => [new RegExp(re.source.replace(/ \??/g, ' ?'), re.flags), cls]);
export const classFromOcrLabel = (label: string) => matchRules(LOOSE_RULES, [label]);

const AUTOCOMPLETE: [RegExp, TokenClass][] = [
  [/(current|new)-password/, 'SECRET'],
  [/one-time-code/, 'SECRET'],
  [/cc-csc/, 'SECRET'],
  [/cc-number/, 'CARD'],
  [/\b(name|given-name|family-name|additional-name|cc-name)\b/, 'NAME'],
  [/\bemail\b/, 'EMAIL'],
  [/\btel/, 'PHONE'],
  [/\bbday/, 'DOB'],
  [/(street-address|address-line|postal-code|address-level)/, 'ADDRESS'],
  [/\busername\b/, 'USERNAME'],
];

export function classFromAutocomplete(ac?: string | null): TokenClass | undefined {
  if (!ac) return undefined;
  const s = ac.toLowerCase();
  for (const [re, cls] of AUTOCOMPLETE) if (re.test(s)) return cls;
  return undefined;
}

const LABEL_VALUE =
  /(^|[.;|,]\s+|\s{2,})([A-Za-z][A-Za-z .'\/()#]{1,40}?)\s*[:：]\s+(.+?)(?=\s*(?:[.;|](?:\s|$)|\s{2,}|$|,?\s+[A-Z][A-Za-z ]{1,30}[:：]))/g;

export function detectLabelValue(text: string): Span[] {
  const out: Span[] = [];
  LABEL_VALUE.lastIndex = 0;
  for (const m of text.matchAll(LABEL_VALUE)) {
    const cls = classFromContext(m[2]);
    if (!cls) continue;
    const start = text.indexOf(m[3], m.index! + m[1].length + m[2].length);
    out.push({ cls, start, end: start + m[3].length, value: m[3], layer: 'L4' });
  }
  return out;
}

export interface Term { term: string; cls: TokenClass; token: string }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function dictSpans(text: string, terms: Term[]): Span[] {
  if (!text || !terms.length) return [];
  const out: Span[] = [];
  for (const { term, cls, token } of [...terms].sort((a, b) => b.term.length - a.term.length)) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu');
    for (const m of text.matchAll(re)) out.push({ cls, start: m.index!, end: m.index! + m[0].length, value: m[0], token, layer: 'L1' });
  }
  return mergeSpans(out);
}

export const detectAll = (text: string, terms: Term[] = []) => mergeSpans(detectPatterns(text), dictSpans(text, terms));

import type { TokenClass } from '../vrs';

const D = [
  [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],
  [4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],
  [8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0],
];
const P = [
  [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],
  [9,4,5,3,1,2,0,7,6,8],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8],
];
const INV = [0,4,3,2,1,5,6,7,8,9];

export const digitsOf = (s: string) => s.replace(/\D/g, '');

export function verhoeff(num: string): boolean {
  const s = digitsOf(num);
  if (!s) return false;
  let c = 0;
  for (let i = 0; i < s.length; i++) c = D[c][P[i % 8][+s[s.length - 1 - i]]];
  return c === 0;
}

export function verhoeffCheckDigit(num: string): number {
  const s = digitsOf(num) + '0';
  let c = 0;
  for (let i = 0; i < s.length; i++) c = D[c][P[i % 8][+s[s.length - 1 - i]]];
  return INV[c];
}

export function luhn(num: string): boolean {
  const s = digitsOf(num);
  if (s.length < 12) return false;
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    let d = +s[s.length - 1 - i];
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

const DIGIT_CLASSES = new Set<TokenClass>(['AADHAAR', 'CARD', 'ACCOUNT']);
const UPPER_CLASSES = new Set<TokenClass>(['PAN', 'IFSC', 'PASSPORT', 'VOTER_ID']);
const LOWER_CLASSES = new Set<TokenClass>(['EMAIL', 'UPI', 'USERNAME']);

export function normalizeValue(cls: TokenClass, v: string): string {
  if (cls === 'PHONE') return digitsOf(v).slice(-10);
  if (DIGIT_CLASSES.has(cls)) return digitsOf(v);
  if (UPPER_CLASSES.has(cls)) return v.replace(/\s+/g, '').toUpperCase();
  if (LOWER_CLASSES.has(cls)) return v.trim().toLowerCase();
  return v.replace(/\s+/g, ' ').trim().toLowerCase();
}

const SHAPE_CLASSES = new Set<TokenClass>(['AADHAAR', 'PAN', 'PHONE', 'IFSC', 'CARD', 'DOB', 'PASSPORT', 'VOTER_ID', 'ACCOUNT']);

export function formatHint(cls: TokenClass, v: string): string | undefined {
  if (!SHAPE_CLASSES.has(cls)) return undefined;
  const src = cls === 'PHONE' ? digitsOf(v).slice(-10) : v.trim();
  return src.replace(/\d/g, '#').replace(/[A-Za-z]/g, 'A');
}

import { describe, expect, it } from 'vitest';
import { luhn, verhoeff, verhoeffCheckDigit, normalizeValue, formatHint } from '@/lib/pii/validators';
import { classFromAutocomplete, classFromContext, detectLabelValue, detectPatterns } from '@/lib/pii/rules';

const cls = (t: string) => detectPatterns(t).map((s) => s.cls);

describe('validators', () => {
  it('verhoeff accepts valid Aadhaar and rejects a single-digit change', () => {
    expect(verhoeff('4821 6630 1979')).toBe(true);
    expect(verhoeff('4821 6630 1978')).toBe(false);
    expect(verhoeffCheckDigit('48216630197')).toBe(9);
  });
  it('luhn', () => {
    expect(luhn('4111 1111 1111 1111')).toBe(true);
    expect(luhn('4111 1111 1111 1112')).toBe(false);
  });
  it('normalizes phones and ids', () => {
    expect(normalizeValue('PHONE', '+91 98450-12345')).toBe('9845012345');
    expect(normalizeValue('AADHAAR', '4821-6630-1979')).toBe('482166301979');
    expect(normalizeValue('EMAIL', ' Ananya.Rao@Mail.IN ')).toBe('ananya.rao@mail.in');
  });
  it('format hints carry shape, not value', () => {
    expect(formatHint('AADHAAR', '4821 6630 1979')).toBe('#### #### ####');
    expect(formatHint('PAN', 'ABCPR1234K')).toBe('AAAAA####A');
    expect(formatHint('EMAIL', 'a@b.in')).toBeUndefined();
  });
});

describe('pattern detection', () => {
  it('finds each class', () => {
    expect(cls('Mail ananya.rao@mail.in now')).toEqual(['EMAIL']);
    expect(cls('Aadhaar 4821 6630 1979')).toEqual(['AADHAAR']);
    expect(cls('PAN ABCPR1234K')).toEqual(['PAN']);
    expect(cls('Card 4111 1111 1111 1111')).toEqual(['CARD']);
    expect(cls('IFSC HDFC0001234')).toEqual(['IFSC']);
    expect(cls('Pay ananya@okaxis')).toEqual(['UPI']);
    expect(cls('Call +91 98450 12345')).toEqual(['PHONE']);
  });
  it('rejects look-alikes', () => {
    expect(cls('Order 482166301978')).toEqual([]);
    expect(cls('Total 1,250.00 on 12/08/2024')).toEqual([]);
    expect(cls('Ref 4111111111111112')).toEqual([]);
  });
  it('keeps grouped Aadhaar even with a bad checksum, flagged invalid', () => {
    const [s] = detectPatterns('UID 4821 6630 1978');
    expect(s.cls).toBe('AADHAAR');
    expect(s.valid).toBe(false);
  });
  it('reports exact offsets', () => {
    const t = 'Reach me at ananya.rao@mail.in today';
    const [s] = detectPatterns(t);
    expect(t.slice(s.start, s.end)).toBe('ananya.rao@mail.in');
  });
});

describe('context', () => {
  it('maps labels', () => {
    expect(classFromContext('Full name')).toBe('NAME');
    expect(classFromContext('Username')).toBe('USERNAME');
    expect(classFromContext('Pin code')).toBe('ADDRESS');
    expect(classFromContext('UPI PIN')).toBe('SECRET');
    expect(classFromContext('Enter OTP')).toBe('SECRET');
    expect(classFromContext('Aadhaar number')).toBe('AADHAAR');
    expect(classFromContext('Date of birth')).toBe('DOB');
    expect(classFromContext('Plan type')).toBeUndefined();
  });
  it('maps autocomplete', () => {
    expect(classFromAutocomplete('current-password')).toBe('SECRET');
    expect(classFromAutocomplete('cc-number')).toBe('CARD');
    expect(classFromAutocomplete('given-name')).toBe('NAME');
    expect(classFromAutocomplete('off')).toBeUndefined();
  });
  it('finds label: value pairs', () => {
    const t = 'Name: Ananya Rao';
    const [s] = detectLabelValue(t);
    expect(s.cls).toBe('NAME');
    expect(t.slice(s.start, s.end)).toBe('Ananya Rao');
    expect(detectLabelValue('Status: Active')).toEqual([]);
  });
});

describe('label-value pairs in running text', () => {
  const pick = (t: string) => detectLabelValue(t).map((s) => [s.cls, t.slice(s.start, s.end)]);
  it('splits several pairs on one line', () => {
    expect(pick('Account number: 12345678901. IFSC: HDFC0ABC123')).toEqual([
      ['ACCOUNT', '12345678901'],
      ['IFSC', 'HDFC0ABC123'],
    ]);
  });
  it('keeps commas inside values and stops at the next label', () => {
    expect(pick('Address: 14, 3rd Cross, Jayanagar, Mobile: +91 98450 12345')).toEqual([
      ['ADDRESS', '14, 3rd Cross, Jayanagar'],
      ['PHONE', '+91 98450 12345'],
    ]);
  });
  it('keeps dotted emails whole and ignores non-sensitive labels', () => {
    expect(pick('Email: a.b@mail.in')).toEqual([['EMAIL', 'a.b@mail.in']]);
    expect(pick('Account holder: Ananya Rao')).toEqual([['NAME', 'Ananya Rao']]);
    expect(pick('Status: Active. Plan: Plus')).toEqual([]);
  });
});

describe('card expiry', () => {
  it('is card data by label or autocomplete', () => {
    expect(classFromContext('Expiry')).toBe('CARD');
    expect(classFromContext('Valid thru')).toBe('CARD');
    expect(classFromAutocomplete('cc-exp')).toBe('CARD');
  });
});

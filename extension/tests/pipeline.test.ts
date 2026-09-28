import { describe, expect, it } from 'vitest';
import { Vault } from '@/lib/vault';
import { sanitize, sanitizeText } from '@/lib/sanitize';
import { firewall, destinationAllowed } from '@/lib/egress';
import { decide } from '@/lib/policy';
import { templatePath } from '@/lib/url';
import type { RawElement, RawSnapshot } from '@/lib/messages';
import type { StepRequest } from '@/lib/vrs';

const SRC = 'https://bank.demo.local';

function el(p: Partial<RawElement> & { vid: number; role: RawElement['role']; label: string }): RawElement {
  return {
    tag: 'input', type: 'text', value: '', hasValue: false, placeholder: '', name: '', idAttr: '', autocomplete: '',
    required: false, disabled: false, bbox: [0, 0, 100, 20], valueBox: [2, 2, 98, 18], ...p,
  };
}

function snap(): RawSnapshot {
  return {
    url: `${SRC}/accounts/new/48213?ref=ananya@mail.in#top`,
    title: 'Open account for Ananya',
    viewport: [1280, 720],
    dpr: 1,
    ms: 3,
    elements: [
      el({ vid: 1, role: 'textbox', label: 'Full name', value: 'Ananya Rao', hasValue: true }),
      el({ vid: 2, role: 'textbox', label: 'Email', value: 'ananya.rao@mail.in', hasValue: true }),
      el({ vid: 3, role: 'textbox', label: 'Aadhaar number' }),
      el({ vid: 4, role: 'password', type: 'password', label: 'Password', hasValue: true }),
      el({ vid: 5, role: 'textbox', label: 'Notes', value: 'call 9845012345 after 5', hasValue: true }),
      el({ vid: 6, role: 'button', tag: 'button', type: 'submit', label: 'Continue' }),
    ],
    texts: [
      {
        vid: 7,
        text: 'Aadhaar: 4821 6630 1979',
        bbox: [0, 100, 300, 120],
        spans: [{ cls: 'AADHAAR', start: 9, end: 23, value: '4821 6630 1979', valid: true, layer: 'L1', rects: [[60, 100, 180, 120]] }],
      },
    ],
    rasters: [{ vid: 8, kind: 'img', alt: 'Photo of Ananya', bbox: [400, 100, 500, 220] }],
  };
}

function request(v: Vault): StepRequest {
  const s = sanitize(snap(), v, SRC);
  return {
    session_id: 's_1', vrs_version: '1.0', goal: 'Fill the form', step: 1, mode: 'pixel',
    screen: { ...s.screen, image: 'data:image/webp;base64,AAAA' }, entities: v.entities(), history: [],
  };
}

describe('sanitize', () => {
  it('tokenizes field values by field class and masks their boxes', () => {
    const v = new Vault();
    const s = sanitize(snap(), v, SRC);
    const byId = Object.fromEntries(s.screen.elements.map((e) => [e.id, e]));
    expect(byId[1].value).toBe('⟦NAME_1⟧');
    expect(byId[2].value).toBe('⟦EMAIL_1⟧');
    expect(byId[3].field_class).toBe('AADHAAR');
    expect(byId[4].value).toBe('⟦SECRET_1⟧');
    expect(byId[5].value).toBe('call ⟦PHONE_1⟧ after 5');
    expect(byId[8].masked).toBe(true);
    expect(s.screen.texts[0].text).toBe('Aadhaar: ⟦AADHAAR_1⟧');
    expect(s.masks.map((m) => m.label)).toEqual(expect.arrayContaining(['⟦NAME_1⟧', '⟦SECRET_1⟧', '⟦AADHAAR_1⟧', '⟦FACE_1⟧', 'REDACTED']));
    expect(s.screen.path_template).toBe('/accounts/new/{id}');
    expect(s.screen.origin).toBe(SRC);
  });

  it('keeps tokens consistent across screens and never stores secrets', () => {
    const v = new Vault();
    sanitize(snap(), v, SRC);
    expect(sanitizeText('Reach Ananya.Rao@mail.in', v, SRC).text).toBe('Reach ⟦EMAIL_1⟧');
    expect(v.get('⟦SECRET_1⟧')?.value).toBe('');
    expect(v.rehydrate('⟦NAME_1⟧ / ⟦EMAIL_1⟧')).toBe('Ananya Rao / ananya.rao@mail.in');
  });

  it('round-trips through serialization', () => {
    const v = new Vault();
    sanitize(snap(), v, SRC);
    const r = Vault.restore(v.serialize());
    expect(r.entities()).toEqual(v.entities());
  });
});

describe('egress firewall', () => {
  const dest = 'http://localhost:8000/v1/step';
  const server = 'http://localhost:8000';

  it('passes a clean payload', () => {
    const v = new Vault();
    const fw = firewall(request(v), v, dest, server, true);
    expect(fw.checks.filter((c) => !c.ok)).toEqual([]);
  });

  it('blocks a raw vault value smuggled into any field', () => {
    const v = new Vault();
    const req = request(v);
    req.history.push({ step: 0, summary: 'user is ananya rao' });
    const fw = firewall(req, v, dest, server, true);
    expect(fw.ok).toBe(false);
    expect(fw.checks.find((c) => c.name === 'Vault match')!.ok).toBe(false);
  });

  it('blocks reformatted numbers', () => {
    const v = new Vault();
    const req = request(v);
    req.goal = 'aadhaar is 4821-6630-1979';
    expect(firewall(req, v, dest, server, true).ok).toBe(false);
  });

  it('blocks undetected identifiers via re-scan', () => {
    const v = new Vault();
    const req = request(v);
    req.screen.texts.push({ id: 99, text: 'PAN ABCPR1234K', bbox: [0, 0, 1, 1] });
    const fw = firewall(req, v, dest, server, true);
    expect(fw.checks.find((c) => c.name === 'Pattern re-scan')!.ok).toBe(false);
  });

  it('blocks bad masks and foreign destinations', () => {
    const v = new Vault();
    expect(firewall(request(v), v, dest, server, false).ok).toBe(false);
    expect(destinationAllowed('https://evil.example/v1/step', server)).toBe(false);
    expect(destinationAllowed('http://api.example.com/v1', 'http://api.example.com')).toBe(false);
  });
});

describe('policy', () => {
  const base = (v: Vault) => ({ vault: v, label: '', origin: SRC, allowedOrigins: new Set([SRC]) });

  it('allows matching field class, confirms mismatch, denies secrets', () => {
    const v = new Vault();
    sanitize(snap(), v, SRC);
    expect(decide({ type: 'type', target: 3, text: '⟦AADHAAR_1⟧' }, { ...base(v), fieldClass: 'AADHAAR', label: 'Aadhaar' }).verdict).toBe('allow');
    expect(decide({ type: 'type', target: 9, text: '⟦AADHAAR_1⟧' }, { ...base(v), label: 'Search' }).verdict).toBe('confirm');
    expect(decide({ type: 'type', target: 4, text: '⟦SECRET_1⟧' }, { ...base(v), fieldClass: 'SECRET' }).verdict).toBe('deny');
    expect(decide({ type: 'type', target: 3, text: '⟦AADHAAR_7⟧' }, { ...base(v), fieldClass: 'AADHAAR' }).verdict).toBe('deny');
  });

  it('confirms irreversible clicks and off-task origins', () => {
    const v = new Vault();
    expect(decide({ type: 'click', target: 6 }, { ...base(v), label: 'Continue' }).verdict).toBe('allow');
    expect(decide({ type: 'click', target: 6 }, { ...base(v), label: 'Submit application' }).verdict).toBe('confirm');
    expect(decide({ type: 'click', target: 6 }, { ...base(v), label: 'Continue', origin: 'https://evil.example' }).verdict).toBe('confirm');
  });
});

describe('url templating', () => {
  it('drops identifiers from paths', () => {
    expect(templatePath('/users/48213/profile')).toBe('/users/{id}/profile');
    expect(templatePath('/u/ananya.rao@mail.in')).toBe('/u/{id}');
    expect(templatePath('/accounts/new')).toBe('/accounts/new');
  });
});

describe('vault dictionary', () => {
  it('redacts a known name wherever it appears, including free text and alt text', () => {
    const v = new Vault();
    const s = sanitize(snap(), v, SRC);
    expect(s.screen.title).toBe('Open account for ⟦NAME_1⟧');
    expect(s.screen.elements.find((e) => e.id === 8)!.label).toBe('Photo of ⟦NAME_1⟧');
    expect(sanitizeText('Welcome back, ananya!', v, SRC).text).toBe('Welcome back, ⟦NAME_1⟧!');
  });

  it('flags a re-snapshot when a newly learned term appears in on-screen text', () => {
    const v = new Vault();
    const raw = snap();
    raw.texts.push({ vid: 9, text: 'Hello Ananya Rao', bbox: [0, 0, 10, 10], spans: [] });
    const s = sanitize(raw, v, SRC);
    expect(s.needsResnap).toBe(true);
    expect(s.screen.texts.at(-1)!.text).toBe('Hello ⟦NAME_1⟧');
  });
});

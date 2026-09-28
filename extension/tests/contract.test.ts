import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Vault } from '@/lib/vault';
import { sanitize } from '@/lib/sanitize';
import { firewall } from '@/lib/egress';
import type { RawSnapshot } from '@/lib/messages';
import type { StepRequest } from '@/lib/vrs';

const raw: RawSnapshot = {
  url: 'http://localhost:5500/bank-form.html',
  title: 'Open a savings account',
  viewport: [1280, 720],
  dpr: 1,
  ms: 4,
  elements: [
    { vid: 1, role: 'textbox', tag: 'input', type: 'text', label: 'Full name', value: '', hasValue: false, placeholder: '', name: 'fullName', idAttr: 'fullName', autocomplete: 'name', required: true, disabled: false, bbox: [24, 102, 274, 128], valueBox: [26, 104, 272, 126] },
    { vid: 2, role: 'textbox', tag: 'input', type: 'text', label: 'Aadhaar number', value: '', hasValue: false, placeholder: '#### #### ####', name: 'aadhaar', idAttr: 'aadhaar', autocomplete: 'off', required: true, disabled: false, bbox: [24, 202, 274, 228], valueBox: [26, 204, 272, 226] },
    { vid: 3, role: 'button', tag: 'button', type: 'submit', label: 'Continue', value: '', hasValue: false, placeholder: '', name: '', idAttr: '', autocomplete: '', required: false, disabled: false, bbox: [296, 252, 396, 278], valueBox: [296, 252, 396, 278] },
  ],
  texts: [],
  rasters: [],
};

describe('contract', () => {
  it('produces a payload the server schema accepts', () => {
    const v = new Vault();
    v.tokenFor('NAME', 'Ananya Rao', 'http://localhost:5500');
    v.tokenFor('AADHAAR', '4821 6630 1979', 'http://localhost:5500', true);
    const s = sanitize(raw, v, 'http://localhost:5500');
    const req: StepRequest = {
      session_id: 'FIXTURE', vrs_version: '1.0', goal: 'Open a savings account using my ID card', step: 1,
      mode: 'structure', screen: s.screen, entities: v.entities(), history: [],
    };
    expect(firewall(req, v, 'http://localhost:8000/v1/step', 'http://localhost:8000', true).ok).toBe(true);
    const dir = fileURLToPath(new URL('../../contracts/', import.meta.url));
    mkdirSync(dir, { recursive: true });
    writeFileSync(dir + 'step_request.json', JSON.stringify(req, null, 2));
  });
});

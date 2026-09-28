import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as ort from 'onnxruntime-web';
import { findNames, tokenize, vocabFrom } from '@/lib/pii/ner';

const MODELS = new URL('../public/models/', import.meta.url);
const have = ['ner.onnx', 'ner-vocab.txt'].every((f) => existsSync(new URL(f, MODELS)));

describe.skipIf(!have)('NER', async () => {
  const vocab = have ? vocabFrom(readFileSync(new URL('ner-vocab.txt', MODELS), 'utf8')) : (null as never);
  const session = have ? await ort.InferenceSession.create(readFileSync(new URL('ner.onnx', MODELS)), { executionProviders: ['wasm'] }) : (null as never);

  it('tokenizes with WordPiece and keeps character offsets', () => {
    const text = 'Ananya Rao, Jayanagar!';
    const pieces = tokenize(text, vocab);
    const inv = new Map([...vocab.ids].map(([t, i]) => [i, t]));
    expect(pieces.map((p) => inv.get(p.id))).toContain(',');
    for (const p of pieces) expect(text.slice(p.start, p.end).length).toBeGreaterThan(0);
    expect(pieces.at(-1)!.end).toBe(text.length);
  });

  it('finds person names in free text and nothing in UI copy', async () => {
    const texts = [
      'Thanks, Ananya Rao. We will text you when your account is ready.',
      'Submit application',
      'Meeting notes: Rahul Verma will call Priya Nair about the loan on Monday.',
      'Open a savings account with Demo Bank in Bengaluru.',
    ];
    const names = await findNames(session, vocab, texts);
    const got = names.map((n) => [n.index, n.value]);
    expect(got).toEqual(expect.arrayContaining([[0, 'Ananya Rao'], [2, 'Rahul Verma'], [2, 'Priya Nair']]));
    expect(names.filter((n) => n.index === 1 || n.index === 3)).toEqual([]);
    for (const n of names) expect(texts[n.index].slice(n.start, n.end)).toBe(n.value);
  });

  it('handles text longer than one window', async () => {
    const filler = 'The branch opens at nine and closes at five on weekdays. '.repeat(60);
    const names = await findNames(session, vocab, [filler + 'Contact Kavya Menon for details.']);
    expect(names.map((n) => n.value)).toContain('Kavya Menon');
  });
});

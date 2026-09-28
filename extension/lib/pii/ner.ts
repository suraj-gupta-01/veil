import * as ort from 'onnxruntime-web';

// L2: person names in free text, from DistilBERT fine-tuned on CoNLL-2003 (cased WordPiece vocabulary).
// Only PER is used: redacting organisations and places would hide the page structure the planner needs.

const LABELS = ['O', 'B-PER', 'I-PER', 'B-ORG', 'I-ORG', 'B-LOC', 'I-LOC', 'B-MISC', 'I-MISC'];
// Short, sentence-aligned segments: long runs of unrelated text dilute the context and the model misses names.
const SEGMENT = 128;
const BATCH = 16;
const MIN_SCORE = 0.7;

export interface Vocab { ids: Map<string, number>; unk: number; cls: number; sep: number; pad: number }
export interface Name { index: number; start: number; end: number; value: string; score: number }

export function vocabFrom(txt: string): Vocab {
  const ids = new Map(txt.split(/\r?\n/).map((t, i) => [t, i] as [string, number]));
  return { ids, unk: ids.get('[UNK]')!, cls: ids.get('[CLS]')!, sep: ids.get('[SEP]')!, pad: ids.get('[PAD]')! };
}

interface Piece { id: number; start: number; end: number; word: number; stop: boolean }

/** BERT basic tokenization (whitespace, then punctuation split) followed by greedy longest-match WordPiece. */
export function tokenize(text: string, v: Vocab): Piece[] {
  const out: Piece[] = [];
  let word = 0;
  for (const m of text.matchAll(/[\p{L}\p{N}\p{M}]+|[^\s\p{L}\p{N}\p{M}]/gu)) {
    const w = m[0];
    const base = m.index!;
    const stop = /^[.!?]$/.test(w);
    const pieces: Piece[] = [];
    let i = 0;
    while (i < w.length) {
      let j = w.length;
      let id: number | undefined;
      for (; j > i; j--) if ((id = v.ids.get((i ? '##' : '') + w.slice(i, j))) !== undefined) break;
      if (id === undefined) { pieces.length = 0; break; }
      pieces.push({ id, start: base + i, end: base + j, word, stop });
      i = j;
    }
    out.push(...(pieces.length && w.length <= 100 ? pieces : [{ id: v.unk, start: base, end: base + w.length, word, stop }]));
    word++;
  }
  return out;
}

/** Split into segments of at most SEGMENT pieces, ending at a sentence stop when one is available. */
function segments(pieces: Piece[]): Piece[][] {
  const out: Piece[][] = [];
  for (let from = 0; from < pieces.length; ) {
    let to = Math.min(pieces.length, from + SEGMENT);
    if (to < pieces.length) {
      let cut = to;
      while (cut > from + 1 && !pieces[cut - 1].stop) cut--;
      if (cut > from + 1) to = cut;
      else while (to > from + 1 && pieces[to].word === pieces[to - 1].word) to--; // never split a word
    }
    out.push(pieces.slice(from, to));
    from = to;
  }
  return out;
}

/** Person names in each text, with character offsets into that text. */
export async function findNames(session: ort.InferenceSession, v: Vocab, texts: string[]): Promise<Name[]> {
  const segs = texts.flatMap((t, index) => segments(tokenize(t, v)).map((pieces) => ({ index, pieces })));
  const names: Name[] = [];

  for (let b = 0; b < segs.length; b += BATCH) {
    const batch = segs.slice(b, b + BATCH);
    const T = Math.max(...batch.map((s) => s.pieces.length)) + 2;
    const ids = new BigInt64Array(batch.length * T).fill(BigInt(v.pad));
    const mask = new BigInt64Array(batch.length * T);
    batch.forEach((s, r) => {
      [v.cls, ...s.pieces.map((p) => p.id), v.sep].forEach((id, c) => { ids[r * T + c] = BigInt(id); mask[r * T + c] = 1n; });
    });
    const out = await session.run({
      input_ids: new ort.Tensor('int64', ids, [batch.length, T]),
      attention_mask: new ort.Tensor('int64', mask, [batch.length, T]),
    });
    const logits = out.logits.data as Float32Array;

    batch.forEach(({ index, pieces }, r) => {
      const text = texts[index];
      // Label each word by its first piece; join consecutive PER words into one name.
      let cur: { start: number; end: number; scores: number[] } | null = null;
      const flush = () => {
        if (cur) {
          const score = cur.scores.reduce((a, s) => a + s, 0) / cur.scores.length;
          if (score >= MIN_SCORE) names.push({ index, start: cur.start, end: cur.end, value: text.slice(cur.start, cur.end), score });
        }
        cur = null;
      };
      pieces.forEach((p, k) => {
        if (k && pieces[k - 1].word === p.word) { if (cur) cur.end = p.end; return; }
        const row = logits.subarray((r * T + k + 1) * LABELS.length, (r * T + k + 2) * LABELS.length);
        const max = Math.max(...row);
        const exp = Array.from(row, (x) => Math.exp(x - max));
        const best = exp.indexOf(1);
        const prob = 1 / exp.reduce((a, e) => a + e, 0);
        const label = LABELS[best];
        if (label === 'B-PER' || (label === 'I-PER' && !cur)) { flush(); cur = { start: p.start, end: p.end, scores: [prob] }; }
        else if (label === 'I-PER') { cur!.end = p.end; cur!.scores.push(prob); }
        else flush();
      });
      flush();
    });
  }
  return names;
}

import { composite } from '@/lib/redact';
import { listen } from '@/lib/runtime';
import { analyze, audit, names } from '@/lib/vision';

listen('offscreen', (msg) => {
  if (msg.kind === 'composite') return composite(msg.req);
  if (msg.kind === 'vision') return analyze(msg.req);
  if (msg.kind === 'audit') return audit(msg.image);
  if (msg.kind === 'ner') return names(msg.texts);
  return undefined;
});

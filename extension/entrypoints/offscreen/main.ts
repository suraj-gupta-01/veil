import { composite } from '@/lib/redact';
import { listen } from '@/lib/runtime';
import { analyze } from '@/lib/vision';

listen('offscreen', (msg) => {
  if (msg.kind === 'composite') return composite(msg.req);
  if (msg.kind === 'vision') return analyze(msg.req);
  return undefined;
});

import { tokensIn, type Action, type TokenClass } from './vrs';
import type { Vault } from './vault';

export type Verdict = { verdict: 'allow' } | { verdict: 'confirm'; reason: string } | { verdict: 'deny'; reason: string };

export interface PolicyContext {
  vault: Vault;
  fieldClass?: TokenClass;
  label: string;
  role?: string;
  origin: string;
  allowedOrigins: Set<string>;
}

const IRREVERSIBLE = /\b(submit|pay|payment|confirm|place order|send|delete|remove|transfer|finish|apply now|sign)\b/i;

const COMPAT: Partial<Record<TokenClass, TokenClass[]>> = {
  USERNAME: ['EMAIL', 'PHONE'],
  ACCOUNT: ['CARD'],
};

export function decide(a: Action, ctx: PolicyContext): Verdict {
  if (!ctx.allowedOrigins.has(ctx.origin) && (a.type === 'type' || a.type === 'click' || a.type === 'select'))
    return { verdict: 'confirm', reason: `The page is now ${ctx.origin}, which was not part of this task.` };

  if (a.type === 'type') {
    for (const t of tokensIn(a.text)) {
      const e = ctx.vault.get(t);
      if (!e) return { verdict: 'deny', reason: `${t} is not a known placeholder.` };
      if (e.cls === 'SECRET') return { verdict: 'deny', reason: 'Secrets are never typed automatically.' };
      const ok = ctx.fieldClass === e.cls || COMPAT[ctx.fieldClass as TokenClass]?.includes(e.cls);
      if (!ok) return { verdict: 'confirm', reason: `Type ${t} (${e.cls}) into “${ctx.label || 'unlabelled field'}”?` };
    }
    return { verdict: 'allow' };
  }

  if (a.type === 'click' && (a.requires_confirmation || IRREVERSIBLE.test(ctx.label)))
    return { verdict: 'confirm', reason: `Click “${ctx.label}”? This may not be reversible.` };

  return { verdict: 'allow' };
}

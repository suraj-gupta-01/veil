import { detectPatterns } from './pii/rules';

const ID_LIKE = [/^\d+$/, /^[0-9a-f]{8,}$/i, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, /@/];

export function templatePath(pathname: string): string {
  return pathname
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      let s = seg;
      try { s = decodeURIComponent(seg); } catch {}
      if (s.length > 32 || ID_LIKE.some((re) => re.test(s)) || detectPatterns(s).length) return '{id}';
      return seg;
    })
    .join('/');
}

export function sanitizeUrl(raw: string): { origin: string; path_template: string } {
  try {
    const u = new URL(raw);
    return { origin: u.origin, path_template: templatePath(u.pathname) };
  } catch {
    return { origin: 'unknown', path_template: '/' };
  }
}

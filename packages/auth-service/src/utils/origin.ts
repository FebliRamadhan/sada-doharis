/**
 * Origin allow-list matching with wildcard subdomain support.
 *
 * CORS_ORIGIN entries may be:
 *   - exact origin:      https://auth.menpan.go.id
 *   - wildcard subdomain: https://*.menpan.go.id  (or  *.menpan.go.id)
 *   - "*"                : allow any origin (use with care)
 *
 * A "*" expands to one-or-more subdomain labels, anchored to the base domain,
 * so "https://*.menpan.go.id" matches "https://auth.menpan.go.id" and
 * "https://satudata.menpan.go.id" but NOT "https://menpan.go.id.evil.com".
 */

function normalize(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin.replace(/^[a-z]+:\/\//i, '');
  }
}

function toRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // escape regex specials
    .replace(/\*/g, '[a-z0-9.-]+'); // wildcard → subdomain label(s)
  return new RegExp(`^${escaped}$`, 'i');
}

/** Parse a comma-separated CORS_ORIGIN string into a normalized pattern list. */
export function parseAllowedOrigins(raw: string | undefined, fallback: string[] = []): string[] {
  const list = raw ? raw.split(',') : fallback;
  return list.map(normalize).filter(Boolean);
}

/** Return true if `origin` is permitted by any of the allow-list `patterns`. */
export function isOriginAllowed(origin: string | undefined | null, patterns: string[]): boolean {
  if (!origin) return false;
  const o = normalize(origin);
  const host = hostOf(o);

  return patterns.some((p) => {
    if (p === '*') return true;
    const target = p.includes('://') ? o : host;
    if (!p.includes('*')) return p === target;
    return toRegExp(p).test(target);
  });
}

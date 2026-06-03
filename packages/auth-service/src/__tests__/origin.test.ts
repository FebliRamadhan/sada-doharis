import { describe, it, expect } from 'vitest';
import { parseAllowedOrigins, isOriginAllowed } from '../utils/origin.js';

describe('parseAllowedOrigins', () => {
  it('splits, trims, and strips trailing slashes', () => {
    expect(parseAllowedOrigins(' https://a.com/, https://b.com ')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('falls back when undefined', () => {
    expect(parseAllowedOrigins(undefined, ['http://localhost:3000'])).toEqual([
      'http://localhost:3000',
    ]);
  });
});

describe('isOriginAllowed', () => {
  const wildcard = ['https://*.menpan.go.id'];

  it('matches subdomains of a wildcard pattern', () => {
    expect(isOriginAllowed('https://auth.menpan.go.id', wildcard)).toBe(true);
    expect(isOriginAllowed('https://satudata.menpan.go.id', wildcard)).toBe(true);
    expect(isOriginAllowed('https://a.b.menpan.go.id', wildcard)).toBe(true);
  });

  it('rejects look-alike domains and wrong scheme', () => {
    expect(isOriginAllowed('https://menpan.go.id.evil.com', wildcard)).toBe(false);
    expect(isOriginAllowed('https://evil.com', wildcard)).toBe(false);
    expect(isOriginAllowed('http://auth.menpan.go.id', wildcard)).toBe(false);
  });

  it('supports exact origins', () => {
    const exact = ['https://auth.menpan.go.id'];
    expect(isOriginAllowed('https://auth.menpan.go.id', exact)).toBe(true);
    expect(isOriginAllowed('https://other.menpan.go.id', exact)).toBe(false);
  });

  it('handles scheme-less host patterns (any scheme)', () => {
    expect(isOriginAllowed('https://auth.menpan.go.id', ['*.menpan.go.id'])).toBe(true);
    expect(isOriginAllowed('http://auth.menpan.go.id', ['*.menpan.go.id'])).toBe(true);
  });

  it('returns false for empty origin and honors "*"', () => {
    expect(isOriginAllowed(undefined, wildcard)).toBe(false);
    expect(isOriginAllowed('https://anything.com', ['*'])).toBe(true);
  });
});

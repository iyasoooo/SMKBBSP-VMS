import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

/**
 * The CSP is the one security header that silently breaks features when it is
 * too tight, so its directives are asserted rather than eyeballed.
 */
function cspFor(
  url = 'http://localhost:3000/visit/request',
  headers?: Record<string, string>,
): Map<string, string[]> {
  const response = middleware(new NextRequest(new Request(url, { headers })));
  const header = response.headers.get('content-security-policy');
  expect(header).toBeTruthy();

  const directives = new Map<string, string[]>();
  for (const part of (header as string).split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) directives.set(name, values);
  }
  return directives;
}

describe('content security policy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lets the IC OCR panel read its WASM core and the card photo', () => {
    // Regression: `connect-src 'self'` blocked both the `data:` URI holding the
    // inlined tesseract WASM binary and the `blob:` object URL for the photo,
    // so every scan failed with "The reader could not start."
    const connectSrc = cspFor().get('connect-src');

    expect(connectSrc).toContain("'self'");
    expect(connectSrc).toContain('blob:');
    expect(connectSrc).toContain('data:');
  });

  it('keeps connect-src closed to remote origins', () => {
    // The point of the directive is that no visitor data can be sent off-origin.
    // `blob:`/`data:` are in-memory reads, not network destinations; a host or
    // wildcard source here would be a real regression.
    const connectSrc = cspFor().get('connect-src') ?? [];

    expect(connectSrc).not.toContain('*');
    for (const source of connectSrc) {
      expect(source).toMatch(/^(?:'self'|blob:|data:)$/);
    }
  });

  it('issues a fresh nonce per request and never allows inline script in production', () => {
    // The nonce only enters script-src in production; dev keeps 'unsafe-inline'
    // so the Next dev overlay can run.
    vi.stubEnv('NODE_ENV', 'production');

    const first = cspFor().get('script-src') ?? [];
    const second = cspFor().get('script-src') ?? [];

    const nonceOf = (values: string[]) => values.find((value) => value.startsWith("'nonce-"));

    expect(nonceOf(first)).toBeDefined();
    expect(nonceOf(first)).not.toEqual(nonceOf(second));
    expect(first).not.toContain("'unsafe-inline'");
    expect(first).toContain("'wasm-unsafe-eval'");
  });

  /**
   * `upgrade-insecure-requests` rewrites subresource URLs to https://. Emitted
   * on a production build reached over plain http - a LAN address during
   * testing - it makes the browser request every stylesheet and script on a
   * port that speaks no TLS, and the page renders as unstyled markup.
   */
  describe('upgrade-insecure-requests', () => {
    it('is absent when the request arrived over plain http', () => {
      vi.stubEnv('NODE_ENV', 'production');
      expect(cspFor('http://192.168.1.4:3000/').has('upgrade-insecure-requests')).toBe(false);
    });

    it('is present when the request arrived over https', () => {
      vi.stubEnv('NODE_ENV', 'production');
      expect(cspFor('https://example.ts.net/').has('upgrade-insecure-requests')).toBe(true);
    });

    it('trusts x-forwarded-proto so a TLS terminating proxy still counts', () => {
      vi.stubEnv('NODE_ENV', 'production');
      // `tailscale serve` and Traefik both terminate TLS and forward over http.
      const directives = cspFor('http://192.168.1.4:3000/', { 'x-forwarded-proto': 'https' });
      expect(directives.has('upgrade-insecure-requests')).toBe(true);
    });

    it('reads only the first hop of a chained x-forwarded-proto', () => {
      vi.stubEnv('NODE_ENV', 'production');
      const chained = cspFor('http://x/', { 'x-forwarded-proto': 'https, http' });
      expect(chained.has('upgrade-insecure-requests')).toBe(true);
    });

    it('is absent in development even over https', () => {
      expect(cspFor('https://localhost:3000/').has('upgrade-insecure-requests')).toBe(false);
    });
  });

  it('forbids embedding and object sources outright', () => {
    const directives = cspFor();

    expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('base-uri')).toEqual(["'self'"]);
  });
});

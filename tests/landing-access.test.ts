import { afterEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../src/proxy';

afterEach(() => vi.unstubAllEnvs());

test.each(['basic', 'session', 'oidc'])('public landing keeps %s workspace access protected', mode => {
  vi.stubEnv('AUTH_MODE', mode);
  vi.stubEnv('DEMO_PASSWORD', 'test-only-password');
  for (const method of ['GET', 'POST']) {
    expect(proxy(new NextRequest('https://example.test/', {method})).headers.get('x-middleware-next')).toBe('1');
  }
  for (const path of ['/benefit-changes', '/gemma', '/settlement', '/savings']) {
    const response = proxy(new NextRequest('https://example.test' + path));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).searchParams.get('next')).toBe(path);
  }
  const api = proxy(new NextRequest('https://example.test/api/benefit-changes'));
  expect([401, 307]).toContain(api.status);
  expect(api.headers.get('x-middleware-next')).toBeNull();
});

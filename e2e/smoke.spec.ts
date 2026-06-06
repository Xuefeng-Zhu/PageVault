import { test, expect } from '@playwright/test';

/**
 * Smoke tests for PageVault's public surface.
 *
 * These verify the routes the smoke-test checklist in
 * docs/DEPLOYMENT.md calls out:
 *   - GET /                -> 200
 *   - GET /login           -> 200
 *   - GET /dashboard       -> 307 redirect to /login
 *   - GET /api/rooms       -> 401 (no auth)
 *
 * If any of these break, something in the auth wiring or routing
 * regressed and the app is unsafe to deploy. That's why they run on
 * every PR — the cost is a few seconds and the catch rate for real
 * regressions is high.
 */

test('GET / returns 200 and renders the home page', async ({ request }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
  // The home page is a marketing page that links to /login. Confirm
  // we didn't get an error page or redirect.
  const body = await res.text();
  expect(body).toContain('PageVault');
});

test('GET /login returns 200 and renders the login form', async ({ request }) => {
  const res = await request.get('/login');
  expect(res.status()).toBe(200);
  const body = await res.text();
  // Login page should have a form. The exact wording is in
  // app/login/page.tsx — search for any of the auth-provider labels
  // (GitHub, Google, credentials) or the heading.
  expect(body.toLowerCase()).toMatch(/log\s*in|sign\s*in/);
});

test('GET /dashboard redirects to /login when unauthenticated', async ({ request }) => {
  // Playwright's `request` follows redirects by default. We want
  // the *final* URL to be /login, not the intermediate 307. So we
  // disable redirect following and check both the status and the
  // Location header.
  const res = await request.get('/dashboard', { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  const location = res.headers()['location'] ?? '';
  expect(location).toContain('/login');
});

test('GET /api/rooms returns 401 when unauthenticated', async ({ request }) => {
  const res = await request.get('/api/rooms');
  expect(res.status()).toBe(401);
});

test('GET /api/cron/notification-worker returns 401 without x-cron-secret', async ({
  request,
}) => {
  // The cron worker has its own auth (the shared secret) and must
  // never accept requests without it. This is the security boundary
  // the audit flagged — verify it's still in place.
  const res = await request.post('/api/cron/notification-worker');
  expect(res.status()).toBe(401);
});

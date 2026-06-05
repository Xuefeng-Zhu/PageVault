import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for PageVault's e2e suite.
 *
 * The suite is intentionally minimal — a smoke test that verifies the
 * public surface is wired correctly. It does NOT exercise the full
 * dashboard or scan flows (those need live InsForge credentials and
 * a seeded room, which is outside the scope of CI).
 *
 * Run locally:
 *   npm run build
 *   npm run start &
 *   npx playwright test
 *
 * CI runs this via .github/workflows/ci.yml (the `e2e` job).
 *
 * The BASE_URL env var defaults to http://localhost:3000 which is
 * what the CI job binds the app to. Override it to point at a
 * staging URL for a manual run.
 */
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never' }]]
    : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // The smoke test is route-only — no logins, no auth flows, no
    // network requests to third parties. A short timeout is fine.
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Don't start the server in Playwright's process — CI's `e2e` job
  // starts `next start` separately so it can pipe logs to an
  // artifact. Locally you can `npm run start &` then `npx playwright test`.
});

// Credential detection helpers for PageVault.
// A credential is "present" only when it is a non-empty string after trimming.
// A malformed value is still treated as present (it will surface as a real-call error).
//
// Required vs optional:
//   - INSFORGE_*  → REQUIRED. The app cannot run without an InsForge backend.
//   - APIFY_*     → OPTIONAL. Missing creds throw a clear error at call time.
//   - OPENAI_*    → OPTIONAL. Missing creds throw a clear error at call time.
//                   Apify and AI use graceful fallback ONLY when the real API call
//                   fails (network, quota, transient error), not when creds are absent.

import { createClient } from '@insforge/sdk';

let _client: ReturnType<typeof createClient> | null = null;
export function getInsforgeClient(): ReturnType<typeof createClient> {
  if (!_client) {
    _client = createClient({
      baseUrl: process.env.INSFORGE_API_URL!,
      anonKey: process.env.INSFORGE_ANON_KEY!,
    });
  }
  return _client;
}

/**
 * Returns true if the given value is a non-empty string after trimming.
 * Used as the primitive for all credential checks.
 */
export function isPresent(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Returns true when Apify credentials are configured.
 * Both API token and Actor ID must be present.
 */
export function hasApifyCreds(): boolean {
  return (
    isPresent(process.env.APIFY_API_TOKEN) &&
    isPresent(process.env.APIFY_ACTOR_ID)
  );
}

/**
 * Returns the base URL for the InsForge REST API (PostgREST-compatible).
 * Throws if INSFORGE_API_URL is not set, matching the safe-by-default
 * posture in lib/scan.ts:281-286.
 *
 * Use this for raw fetch() calls; use getInsforgeClient() for SDK calls.
 */
export function getInsforgeBaseUrl(): string {
  const url = process.env.INSFORGE_API_URL;
  if (!url || url.trim().length === 0) {
    throw new Error('INSFORGE_API_URL is not set; cannot make InsForge REST calls');
  }
  return url.replace(/\/+$/, '');  // strip trailing slash
}

/**
 * Returns true when AI/LLM credentials are configured.
 * Requires an OpenAI-compatible API key.
 */
export function hasAiCreds(): boolean {
  return isPresent(process.env.OPENAI_API_KEY);
}
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
 * Returns true when AI/LLM credentials are configured.
 * Requires an OpenAI-compatible API key.
 */
export function hasAiCreds(): boolean {
  return isPresent(process.env.OPENAI_API_KEY);
}
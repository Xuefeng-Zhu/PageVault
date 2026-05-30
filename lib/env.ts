// Credential detection helpers for PageVault
// A credential is "present" only when it is a non-empty string after trimming.
// A malformed value is still treated as present (it will surface as a real-call error).

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
 * Returns true when Box credentials are configured.
 * Either a developer token OR client id+secret pair must be present.
 */
export function hasBoxCreds(): boolean {
  return (
    isPresent(process.env.BOX_DEVELOPER_TOKEN) ||
    (isPresent(process.env.BOX_CLIENT_ID) && isPresent(process.env.BOX_CLIENT_SECRET))
  );
}

/**
 * Returns true when AI/LLM credentials are configured.
 * Requires an OpenAI-compatible API key.
 */
export function hasAiCreds(): boolean {
  return isPresent(process.env.OPENAI_API_KEY);
}

/**
 * Returns true when Insforge credentials are configured.
 * Requires API URL and either a service role key or anon key.
 */
export function hasInsforgeCreds(): boolean {
  return (
    isPresent(process.env.INSFORGE_API_URL) &&
    (isPresent(process.env.INSFORGE_SERVICE_ROLE_KEY) || isPresent(process.env.INSFORGE_ANON_KEY))
  );
}
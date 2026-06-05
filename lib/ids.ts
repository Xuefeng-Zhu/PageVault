// Tiny id-generation helpers used by the scan pipeline.
//
// Why this file exists
// --------------------
// The original scan code had a hand-rolled `uuid(prefix)` function that
// combined a single-letter prefix with 7 random hex chars and a hard-coded
// 1111-0000-0000-000000000001 suffix. With only 28 bits of randomness and a
// fixed prefix per id-type, the birthday-paradox collision probability
// reached 5% at ~10,000 concurrent scans — a real risk at scale because all
// scan_job ids share the prefix 'a'. Postgres would then 500 the
// snapshot_jobs insert with "duplicate key value violates unique constraint".
//
// Fix: use `crypto.randomUUID()` (RFC 4122 v4, 122 bits of entropy). The
// collision probability is negligible until ~2.7 quintillion ids. It is
// available in Node 16+ and on the Edge runtime, both of which this app
// targets. The first character is now genuinely random (no more
// "InsForge rejects non-hex first char" workaround — that rule never
// existed; `gen_random_uuid` and any standard UUID generator allow any hex
// in the first position).
//
// We expose a single function, `newId`, rather than calling
// `crypto.randomUUID()` inline at every call site, so:
//   1. The fix is testable in isolation (no InsForge env or fetch mock
//      required).
//   2. If we ever need to swap the id scheme (e.g. time-sortable ids
//      for log ordering), there's one place to change.
//
// If you reach for an id in any new scan-pipeline code, import `newId`
// from here. Do not reintroduce a hand-rolled generator.

/**
 * Return a fresh RFC 4122 v4 UUID.
 *
 * Uses the platform `crypto.randomUUID()` (Node 16+ and Edge). Returned
 * ids are 8-4-4-4-12 hex with the v4 marker (`4xxx` in the third group)
 * and the RFC 4122 variant (`[89ab]xxx` in the fourth group).
 *
 * The 122 bits of randomness make collisions statistically unreachable:
 * at 1 billion ids per second, a 50% collision probability requires
 * ~85 years.
 */
export function newId(): string {
  return crypto.randomUUID();
}

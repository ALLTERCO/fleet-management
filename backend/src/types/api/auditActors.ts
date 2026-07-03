/**
 * Shared audit actor sentinels + normalizer.
 * Single source of truth — imported by backend (write-time) and frontend
 * (display styling) via the @api alias.
 */

/** Backend-driven event (device lifecycle, plugin, internal task). */
export const SYSTEM_ACTOR = 'system';

/** Synthetic user created per API-test-suite run. */
export const API_TEST_ACTOR = 'api-test';

/**
 * Match any synthetic test-runner username so every run collapses to
 * API_TEST_ACTOR.
 *
 * Coupled to the naming convention in `deploy/tests/run-api-tests.sh`
 * (`TEST_USER_NAME="api-test-runner-$(date +%s)"`). If the shell script
 * ever changes its prefix, update this regex to match — there is no
 * cross-language single-source mechanism we can share.
 */
const API_TEST_USERNAME_RE = /^api-test-runner-\d+$/;

export function normalizeActor(raw: string | undefined | null): string {
    if (!raw) return SYSTEM_ACTOR;
    if (API_TEST_USERNAME_RE.test(raw)) return API_TEST_ACTOR;
    return raw;
}

/** Sentinels that should render with a distinct badge, not as a real username. */
export const SENTINEL_ACTORS: ReadonlySet<string> = new Set([
    SYSTEM_ACTOR,
    API_TEST_ACTOR
]);

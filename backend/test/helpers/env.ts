/**
 * Configuration the backend reads at import time.
 *
 * Several modules under `src/config` freeze their values on load and throw when a required
 * variable is absent, so anything that transitively imports one — which is most of the backend —
 * cannot be loaded by a test at all without these being present. Import this module before the
 * code under test; import order is the whole mechanism.
 *
 * The values mirror `deploy/env/public.env` so a test sees what a default OSS deployment sees,
 * and each is only filled in when the environment has not already chosen one — so a real
 * configuration around the test run still wins.
 *
 * Deliberately not secrets or endpoints that would do anything if reached: the SMTP and Redis
 * entries are the empty values the public deployment ships, and the OAuth base is a placeholder.
 * A test that needs a working dependency has to bring its own.
 */
const defaults: Record<string, string> = {
    FM_API_CONTRACT_VERSION: '1',
    FM_UI_CONTRACT_VERSION: '1',
    FM_FRONTEND_ARTIFACT_ID: 'default-template',
    FM_FRONTEND_ARTIFACT_VERSION: 'default',
    FM_SAFE_MODE: 'false',
    FM_DEPLOYMENT_MODE: 'oss',

    FM_AUTHZ_GROUP_DEPTH_MAX: '16',
    FM_AUTHZ_L1_MAX_ENTRIES: '10000',
    FM_AUTHZ_L1_TTL_SECONDS: '60',
    FM_AUTHZ_L2_TTL_SECONDS: '300',
    FM_AUTHZ_PUBSUB_CHANNEL_PREFIX: 'authz:invalidate',
    FM_AUTHZ_REDIS_KEY_PREFIX: 'authz',
    FM_AUTHZ_UNUSED_THRESHOLD_DAYS: '90',

    FM_SCOPED_PAT_RETENTION_DAYS: '30',
    FM_SCOPED_PAT_SWEEP_INTERVAL_MS: '3600000',
    ZITADEL_LIST_PAGE_SIZE: '1000',
    ZITADEL_PAT_DEFAULT_EXPIRATION_DAYS: '365',

    FM_NOTIFICATION_SMTP_FROM: '',
    FM_NOTIFICATION_SMTP_HOST: '',
    FM_NOTIFICATION_SMTP_PORT: '',
    FM_NOTIFICATION_SMTP_SECURE: '',
    FM_REDIS_URL: '',
    FM_OAUTH_REDIRECT_BASE: 'http://127.0.0.1:0/test-only'
};

for (const [name, value] of Object.entries(defaults)) {
    if (process.env[name] === undefined) process.env[name] = value;
}

--------------UP
-- Sync integration_endpoints.provider with INTEGRATION_PROVIDERS
-- (src/types/api/integration.ts). The four newer providers shipped config
-- schemas + delivery adapters, but the original CHECK (migration 2002) was
-- never widened, so creating them failed at the DB. Widen to the full set.
-- A drift-guard test (integrationProviderCheckSync.test.ts) pins this CHECK to
-- the TS constant so the two can never silently diverge again.
ALTER TABLE notifications.integration_endpoints
    DROP CONSTRAINT IF EXISTS integration_endpoints_provider_valid;
ALTER TABLE notifications.integration_endpoints
    ADD CONSTRAINT integration_endpoints_provider_valid CHECK (provider IN (
        'email_smtp',
        'generic_webhook',
        'slack_webhook',
        'teams_workflow_webhook',
        'telegram_bot',
        'push_fcm',
        'sms_twilio',
        'voice_twilio',
        'webhook_signed'
    ));

--------------DOWN
ALTER TABLE notifications.integration_endpoints
    DROP CONSTRAINT IF EXISTS integration_endpoints_provider_valid;
ALTER TABLE notifications.integration_endpoints
    ADD CONSTRAINT integration_endpoints_provider_valid CHECK (provider IN (
        'email_smtp',
        'generic_webhook',
        'slack_webhook',
        'teams_workflow_webhook',
        'telegram_bot'
    ));

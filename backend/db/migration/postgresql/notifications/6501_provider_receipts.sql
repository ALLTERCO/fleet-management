--------------UP
CREATE TABLE IF NOT EXISTS notifications.provider_receipts (
    id                    BIGSERIAL    PRIMARY KEY,
    organization_id       VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    endpoint_id           INTEGER      REFERENCES notifications.integration_endpoints(id) ON DELETE SET NULL,
    provider              VARCHAR(64)  NOT NULL,
    kind                  VARCHAR(24)  NOT NULL,
    provider_message_id   VARCHAR(255),
    recipient             VARCHAR(320),
    occurred_at           TIMESTAMPTZ  NOT NULL,
    raw_event_type        VARCHAR(120),
    payload               JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT provider_receipts_kind_valid CHECK (
        kind IN ('delivered', 'bounced', 'complained', 'suppressed', 'unknown')
    ),
    CONSTRAINT provider_receipts_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS provider_receipts_by_org_time
    ON notifications.provider_receipts (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS provider_receipts_by_provider_message
    ON notifications.provider_receipts (provider, provider_message_id)
    WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS notifications.notification_suppressions (
    id                    BIGSERIAL    PRIMARY KEY,
    organization_id       VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    channel_type          VARCHAR(64)  NOT NULL,
    recipient             VARCHAR(320) NOT NULL,
    recipient_key         VARCHAR(320) NOT NULL,
    reason                VARCHAR(24)  NOT NULL,
    provider              VARCHAR(64),
    provider_message_id   VARCHAR(255),
    active                BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ,
    last_seen_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT notification_suppressions_reason_valid CHECK (
        reason IN ('bounced', 'complained', 'suppressed')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_suppressions_unique_active_reason
    ON notifications.notification_suppressions (
        organization_id, channel_type, recipient_key, reason
    );

CREATE OR REPLACE FUNCTION notifications.fn_provider_receipt_record(
    p_organization_id      VARCHAR,
    p_endpoint_id          INTEGER,
    p_provider             VARCHAR,
    p_kind                 VARCHAR,
    p_provider_message_id  VARCHAR DEFAULT NULL,
    p_recipient            VARCHAR DEFAULT NULL,
    p_occurred_at          TIMESTAMPTZ DEFAULT NOW(),
    p_raw_event_type       VARCHAR DEFAULT NULL,
    p_payload              JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    receipt_id     BIGINT,
    suppression_id BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_receipt_id     BIGINT;
    v_suppression_id BIGINT;
BEGIN
    INSERT INTO notifications.provider_receipts (
        organization_id,
        endpoint_id,
        provider,
        kind,
        provider_message_id,
        recipient,
        occurred_at,
        raw_event_type,
        payload
    )
    VALUES (
        p_organization_id,
        p_endpoint_id,
        p_provider,
        p_kind,
        p_provider_message_id,
        p_recipient,
        p_occurred_at,
        p_raw_event_type,
        COALESCE(p_payload, '{}'::jsonb)
    )
    RETURNING id INTO v_receipt_id;

    IF p_endpoint_id IS NOT NULL AND p_kind IN ('delivered', 'bounced', 'complained', 'suppressed') THEN
        UPDATE notifications.integration_endpoints
        SET last_delivery_at     = NOW(),
            last_delivery_status = CASE WHEN p_kind = 'delivered' THEN 'success' ELSE 'failed' END,
            last_success_at      = CASE WHEN p_kind = 'delivered' THEN NOW() ELSE last_success_at END,
            last_failure_at      = CASE WHEN p_kind <> 'delivered' THEN NOW() ELSE last_failure_at END,
            updated_at           = NOW()
        WHERE id = p_endpoint_id
          AND organization_id = p_organization_id;
    END IF;

    IF p_kind IN ('bounced', 'complained', 'suppressed') AND COALESCE(TRIM(p_recipient), '') <> '' THEN
        INSERT INTO notifications.notification_suppressions (
            organization_id,
            channel_type,
            recipient,
            recipient_key,
            reason,
            provider,
            provider_message_id
        )
        VALUES (
            p_organization_id,
            p_provider,
            TRIM(p_recipient),
            LOWER(TRIM(p_recipient)),
            p_kind,
            p_provider,
            p_provider_message_id
        )
        ON CONFLICT (organization_id, channel_type, recipient_key, reason)
        DO UPDATE SET
            recipient           = EXCLUDED.recipient,
            provider            = EXCLUDED.provider,
            provider_message_id = EXCLUDED.provider_message_id,
            active              = TRUE,
            updated_at          = NOW(),
            last_seen_at        = NOW()
        RETURNING id INTO v_suppression_id;
    END IF;

    RETURN QUERY SELECT v_receipt_id, v_suppression_id;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_provider_receipt_record(
    VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TIMESTAMPTZ, VARCHAR, JSONB
);
DROP TABLE IF EXISTS notifications.notification_suppressions;
DROP TABLE IF EXISTS notifications.provider_receipts;

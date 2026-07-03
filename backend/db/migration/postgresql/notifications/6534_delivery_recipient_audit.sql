-- Phase 6f: GDPR-compliant delivery audit log keyed by recipient.
--
-- Each row is one outbound delivery attempt. The recipient address is
-- stored hashed (SHA-256) for GDPR data-minimisation; the raw address
-- is kept in a separate column with a short TTL so support can replay
-- recent failures, but the hash is what we index and search on for
-- right-to-be-forgotten requests (one DELETE WHERE recipient_hash=$1
-- wipes every trace of a person).

--------------UP

CREATE TABLE IF NOT EXISTS delivery_recipient_audit (
    id              BIGSERIAL PRIMARY KEY,
    organization_id TEXT        NOT NULL,
    alert_id        BIGINT,
    rule_id         BIGINT,
    channel_id      BIGINT,
    channel_kind    TEXT        NOT NULL,
    recipient_hash  TEXT        NOT NULL,
    recipient_raw   TEXT,
    raw_expires_at  TIMESTAMPTZ,
    outcome         TEXT        NOT NULL
                    CHECK (outcome IN (
                        'queued',
                        'sent',
                        'delivered',
                        'failed',
                        'suppressed',
                        'opted_out'
                    )),
    provider        TEXT,
    provider_msg_id TEXT,
    error_code      TEXT,
    severity        TEXT
                    CHECK (severity IS NULL OR severity IN (
                        'critical', 'warning', 'info'
                    )),
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ix_delivery_audit_org_sent
    ON delivery_recipient_audit (organization_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS ix_delivery_audit_recipient
    ON delivery_recipient_audit (recipient_hash);

CREATE INDEX IF NOT EXISTS ix_delivery_audit_alert
    ON delivery_recipient_audit (alert_id)
    WHERE alert_id IS NOT NULL;

-- Hash any plain-text recipient address (email, phone E.164, push token).
-- Kept inside the DB so a single representation is used everywhere and
-- a leaked log file does not expose PII.
CREATE OR REPLACE FUNCTION fn_audit_recipient_hash(p_recipient TEXT)
    RETURNS TEXT
    LANGUAGE plpgsql
    IMMUTABLE
AS $$
BEGIN
    IF p_recipient IS NULL THEN
        RETURN NULL;
    END IF;
    -- pgcrypto lives in the organization schema (user/20004) — qualify
    -- so this resolves on a real boot, not just on a search_path-friendly
    -- test DB.
    RETURN encode(organization.digest(lower(trim(p_recipient)), 'sha256'), 'hex');
END;
$$;

-- Append-only audit recorder. raw_ttl_minutes=0 means "do not retain"
-- the plain-text recipient at all; default 1440 keeps it for 24h so
-- the support team can replay a same-day delivery if a customer asks.
CREATE OR REPLACE FUNCTION fn_delivery_audit_record(
    p_organization_id TEXT,
    p_channel_kind    TEXT,
    p_recipient       TEXT,
    p_outcome         TEXT,
    p_alert_id        BIGINT  DEFAULT NULL,
    p_rule_id         BIGINT  DEFAULT NULL,
    p_channel_id      BIGINT  DEFAULT NULL,
    p_provider        TEXT    DEFAULT NULL,
    p_provider_msg_id TEXT    DEFAULT NULL,
    p_error_code      TEXT    DEFAULT NULL,
    p_severity        TEXT    DEFAULT NULL,
    p_metadata        JSONB   DEFAULT '{}'::jsonb,
    p_raw_ttl_minutes INTEGER DEFAULT 1440
)
    RETURNS BIGINT
    LANGUAGE plpgsql
AS $$
DECLARE
    v_id              BIGINT;
    v_recipient_hash  TEXT;
    v_raw             TEXT;
    v_raw_expires_at  TIMESTAMPTZ;
BEGIN
    v_recipient_hash := notifications.fn_audit_recipient_hash(p_recipient);
    IF p_raw_ttl_minutes > 0 THEN
        v_raw := p_recipient;
        v_raw_expires_at := NOW() + (p_raw_ttl_minutes || ' minutes')::INTERVAL;
    END IF;

    INSERT INTO notifications.delivery_recipient_audit (
        organization_id, alert_id, rule_id, channel_id, channel_kind,
        recipient_hash, recipient_raw, raw_expires_at,
        outcome, provider, provider_msg_id, error_code,
        severity, metadata
    )
    VALUES (
        p_organization_id, p_alert_id, p_rule_id, p_channel_id, p_channel_kind,
        v_recipient_hash, v_raw, v_raw_expires_at,
        p_outcome, p_provider, p_provider_msg_id, p_error_code,
        p_severity, COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

-- Right-to-be-forgotten: wipe every audit row for one recipient.
-- Returns the count of rows deleted so the caller can confirm.
CREATE OR REPLACE FUNCTION fn_delivery_audit_forget(p_recipient TEXT)
    RETURNS INTEGER
    LANGUAGE plpgsql
AS $$
DECLARE
    v_hash    TEXT;
    v_deleted INTEGER;
BEGIN
    v_hash := notifications.fn_audit_recipient_hash(p_recipient);
    IF v_hash IS NULL THEN
        RETURN 0;
    END IF;
    DELETE FROM notifications.delivery_recipient_audit WHERE recipient_hash = v_hash;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

-- TTL sweep: clear the raw recipient field once raw_expires_at passes,
-- keeping the hashed audit row for long-term reporting.
CREATE OR REPLACE FUNCTION fn_delivery_audit_redact_expired()
    RETURNS INTEGER
    LANGUAGE plpgsql
AS $$
DECLARE
    v_redacted INTEGER;
BEGIN
    UPDATE notifications.delivery_recipient_audit
       SET recipient_raw = NULL,
           raw_expires_at = NULL
     WHERE recipient_raw IS NOT NULL
       AND raw_expires_at IS NOT NULL
       AND raw_expires_at < NOW();
    GET DIAGNOSTICS v_redacted = ROW_COUNT;
    RETURN v_redacted;
END;
$$;

--------------DOWN

DROP FUNCTION IF EXISTS fn_delivery_audit_redact_expired();
DROP FUNCTION IF EXISTS fn_delivery_audit_forget(TEXT);
DROP FUNCTION IF EXISTS fn_delivery_audit_record(
    TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, TEXT, TEXT,
    TEXT, TEXT, JSONB, INTEGER
);
DROP FUNCTION IF EXISTS fn_audit_recipient_hash(TEXT);
DROP INDEX IF EXISTS ix_delivery_audit_alert;
DROP INDEX IF EXISTS ix_delivery_audit_recipient;
DROP INDEX IF EXISTS ix_delivery_audit_org_sent;
DROP TABLE IF EXISTS delivery_recipient_audit;

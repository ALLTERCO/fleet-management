-- 6534 placed unqualified digest(), cross-function calls AND table refs
-- inside its functions. pgcrypto lives in `organization` (user/20004),
-- the audit objects live in `notifications`, and PL/pgSQL function
-- bodies inherit the default search_path (`"$user", public`), so the
-- unqualified references compiled but crashed at first invocation:
--   ERROR: function digest(text, unknown) does not exist
--   ERROR: function fn_audit_recipient_hash(...) does not exist
--   ERROR: relation "delivery_recipient_audit" does not exist
-- This migration replaces all four bodies for any DB that already
-- applied the broken 6534. Fresh DBs get the corrected bodies via 6534.

--------------UP

CREATE OR REPLACE FUNCTION fn_audit_recipient_hash(p_recipient TEXT)
    RETURNS TEXT
    LANGUAGE plpgsql
    IMMUTABLE
AS $$
BEGIN
    IF p_recipient IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN encode(organization.digest(lower(trim(p_recipient)), 'sha256'), 'hex');
END;
$$;

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

-- Restore the pre-fix bodies (unqualified calls) so DOWN is reversible.
CREATE OR REPLACE FUNCTION fn_audit_recipient_hash(p_recipient TEXT)
    RETURNS TEXT
    LANGUAGE plpgsql
    IMMUTABLE
AS $$
BEGIN
    IF p_recipient IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN encode(digest(lower(trim(p_recipient)), 'sha256'), 'hex');
END;
$$;

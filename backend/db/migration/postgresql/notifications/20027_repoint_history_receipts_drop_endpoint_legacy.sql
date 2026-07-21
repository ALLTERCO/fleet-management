--------------UP
-- Complete the integration_endpoints -> channels rename (20021). Two live
-- functions still read the old table and error on every call:
--   fn_delivery_job_list      -> notification.history.list ("Internal error")
--   fn_provider_receipt_record -> provider receipt webhooks
-- Repoint their single table reference each. Also drop the superseded
-- endpoint-era functions: every one of them references the dropped table,
-- so none of them can execute; their fn_channel_* replacements landed in
-- 20021 and later.

CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_list(
    p_organization_id VARCHAR,
    p_endpoint_id     INTEGER     DEFAULT NULL,
    p_state           VARCHAR     DEFAULT NULL,
    p_provider        VARCHAR     DEFAULT NULL,
    p_alert_id        INTEGER     DEFAULT NULL,
    p_from            TIMESTAMPTZ DEFAULT NULL,
    p_to              TIMESTAMPTZ DEFAULT NULL,
    p_limit           INTEGER     DEFAULT 200,
    p_offset          INTEGER     DEFAULT 0
)
RETURNS TABLE (
    total_count     BIGINT,
    id              INTEGER,
    organization_id VARCHAR,
    alert_id        INTEGER,
    inbox_item_id   INTEGER,
    endpoint_id     INTEGER,
    state           VARCHAR,
    created_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    attempt_count   INTEGER
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT j.*
        FROM notifications.delivery_jobs j
        LEFT JOIN notifications.channels e
               ON e.id = j.endpoint_id
        WHERE j.organization_id = p_organization_id
          AND (p_endpoint_id IS NULL OR j.endpoint_id = p_endpoint_id)
          AND (p_state       IS NULL OR j.state       = p_state)
          AND (p_provider    IS NULL OR e.provider    = p_provider)
          AND (p_alert_id    IS NULL OR j.alert_id    = p_alert_id)
          AND (p_from        IS NULL OR j.created_at >= p_from)
          AND (p_to          IS NULL OR j.created_at <  p_to)
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        j.id, j.organization_id, j.alert_id, j.inbox_item_id, j.endpoint_id,
        j.state, j.created_at, j.completed_at, j.attempt_count
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY created_at DESC, id DESC
        LIMIT p_limit OFFSET p_offset
    ) j ON TRUE;
$$;

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
        UPDATE notifications.channels
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

-- Superseded endpoint-era functions. Dropped via pg_proc so every remaining
-- overload goes (6208 re-created some with widened signatures, so a plain
-- DROP FUNCTION by name would raise "function name is not unique").
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'notifications'
          AND p.proname IN (
              'fn_alert_rule_replace_destination_endpoints',
              'fn_alert_rule_resolved_endpoints',
              'fn_channel_upsert',
              'fn_delivery_job_create_for_destination_groups',
              'fn_endpoint_quiet_hours_until',
              'fn_endpoint_record_delivery',
              'fn_endpoint_reset_health',
              'fn_integration_endpoint_create',
              'fn_integration_endpoint_delete',
              'fn_integration_endpoint_get',
              'fn_integration_endpoint_list',
              'fn_integration_endpoint_secret_get',
              'fn_integration_endpoint_secret_set',
              'fn_integration_endpoint_set_test_result',
              'fn_integration_endpoint_update'
          )
    LOOP
        EXECUTE format('DROP FUNCTION %s', r.sig);
    END LOOP;
END;
$$;

--------------DOWN
-- The pre-20021 definitions read a table that no longer exists (their UP
-- predecessors are unusable), so the DOWN re-asserts the corrected
-- definitions instead of restoring broken ones. The dropped endpoint-era
-- functions stay dropped for the same reason.
CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_list(
    p_organization_id VARCHAR,
    p_endpoint_id     INTEGER     DEFAULT NULL,
    p_state           VARCHAR     DEFAULT NULL,
    p_provider        VARCHAR     DEFAULT NULL,
    p_alert_id        INTEGER     DEFAULT NULL,
    p_from            TIMESTAMPTZ DEFAULT NULL,
    p_to              TIMESTAMPTZ DEFAULT NULL,
    p_limit           INTEGER     DEFAULT 200,
    p_offset          INTEGER     DEFAULT 0
)
RETURNS TABLE (
    total_count     BIGINT,
    id              INTEGER,
    organization_id VARCHAR,
    alert_id        INTEGER,
    inbox_item_id   INTEGER,
    endpoint_id     INTEGER,
    state           VARCHAR,
    created_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    attempt_count   INTEGER
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT j.*
        FROM notifications.delivery_jobs j
        LEFT JOIN notifications.channels e
               ON e.id = j.endpoint_id
        WHERE j.organization_id = p_organization_id
          AND (p_endpoint_id IS NULL OR j.endpoint_id = p_endpoint_id)
          AND (p_state       IS NULL OR j.state       = p_state)
          AND (p_provider    IS NULL OR e.provider    = p_provider)
          AND (p_alert_id    IS NULL OR j.alert_id    = p_alert_id)
          AND (p_from        IS NULL OR j.created_at >= p_from)
          AND (p_to          IS NULL OR j.created_at <  p_to)
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        j.id, j.organization_id, j.alert_id, j.inbox_item_id, j.endpoint_id,
        j.state, j.created_at, j.completed_at, j.attempt_count
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY created_at DESC, id DESC
        LIMIT p_limit OFFSET p_offset
    ) j ON TRUE;
$$;

--------------UP
-- LINT-IGNORE: additive-only (deliberate legacy function removal)
DO $$
DECLARE
    legacy_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO legacy_count FROM notifications.channels;
    IF legacy_count <> 0 THEN
        RAISE EXCEPTION 'legacy notifications.channels is not empty (% rows); refusing channel rename', legacy_count;
    END IF;
END;
$$;

DROP FUNCTION IF EXISTS notifications.fn_channel_get(VARCHAR, BIGINT);
DROP FUNCTION IF EXISTS notifications.fn_channel_delete(VARCHAR, BIGINT);
DROP FUNCTION IF EXISTS notifications.fn_channel_upsert(VARCHAR, BIGINT, VARCHAR, VARCHAR, JSONB);
DROP FUNCTION IF EXISTS notifications.fn_channel_upsert(VARCHAR, BIGINT, VARCHAR, VARCHAR, JSONB, INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_channel_list(VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS notifications.fn_channel_record_test_result(VARCHAR, BIGINT, VARCHAR, BOOLEAN);

-- LINT-IGNORE: additive-only -- legacy table is guarded empty above.
DROP TABLE IF EXISTS notifications.channels;

-- LINT-IGNORE: additive-only -- preserve live rows while renaming the model.
ALTER TABLE notifications.integration_endpoints RENAME TO channels;
-- LINT-IGNORE: additive-only -- preserve encrypted secrets while renaming.
ALTER TABLE notifications.integration_endpoint_secrets RENAME TO channel_secrets;

-- LINT-IGNORE: additive-only -- index rename follows the table rename.
ALTER INDEX IF EXISTS notifications.integration_endpoints_name_by_org RENAME TO channels_name_by_org;
-- LINT-IGNORE: additive-only -- index rename follows the table rename.
ALTER INDEX IF EXISTS notifications.integration_endpoints_by_org_provider RENAME TO channels_by_org_provider;

ALTER TABLE notifications.channels
    RENAME CONSTRAINT integration_endpoints_provider_valid TO channels_provider_valid;
ALTER TABLE notifications.channels
    RENAME CONSTRAINT integration_endpoints_last_test_status_valid TO channels_last_test_status_valid;
ALTER TABLE notifications.channels
    RENAME CONSTRAINT integration_endpoints_last_delivery_status_valid TO channels_last_delivery_status_valid;
ALTER TABLE notifications.channels
    RENAME CONSTRAINT integration_endpoints_quiet_hours_start_valid TO channels_quiet_hours_start_valid;
ALTER TABLE notifications.channels
    RENAME CONSTRAINT integration_endpoints_quiet_hours_end_valid TO channels_quiet_hours_end_valid;
ALTER TABLE notifications.channels
    RENAME CONSTRAINT integration_endpoints_quiet_hours_paired TO channels_quiet_hours_paired;
ALTER TABLE notifications.channels
    RENAME CONSTRAINT integration_endpoints_consecutive_failures_non_negative TO channels_consecutive_failures_non_negative;

CREATE OR REPLACE FUNCTION notifications.fn_channel_get(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id                    INTEGER,
    organization_id       VARCHAR,
    provider              VARCHAR,
    name                  VARCHAR,
    enabled               BOOLEAN,
    config                JSONB,
    has_secret_fields     BOOLEAN,
    last_test_at          TIMESTAMPTZ,
    last_test_status      VARCHAR,
    last_delivery_at      TIMESTAMPTZ,
    last_delivery_status  VARCHAR,
    consecutive_failures  INTEGER,
    last_success_at       TIMESTAMPTZ,
    last_failure_at       TIMESTAMPTZ,
    auto_disabled_at      TIMESTAMPTZ,
    disable_reason        VARCHAR,
    quiet_hours_start     INTEGER,
    quiet_hours_end       INTEGER,
    quiet_hours_tz        VARCHAR,
    created_at            TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT
        e.id, e.organization_id, e.provider, e.name, e.enabled, e.config,
        (s.endpoint_id IS NOT NULL) AS has_secret_fields,
        e.last_test_at, e.last_test_status,
        e.last_delivery_at, e.last_delivery_status,
        e.consecutive_failures, e.last_success_at, e.last_failure_at,
        e.auto_disabled_at, e.disable_reason,
        e.quiet_hours_start, e.quiet_hours_end, e.quiet_hours_tz,
        e.created_at, e.updated_at
    FROM notifications.channels e
    LEFT JOIN notifications.channel_secrets s ON s.endpoint_id = e.id
    WHERE e.organization_id = p_organization_id
      AND e.id = p_id;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_channel_list(
    p_organization_id VARCHAR,
    p_provider        VARCHAR DEFAULT NULL,
    p_enabled         BOOLEAN DEFAULT NULL,
    p_query           VARCHAR DEFAULT NULL,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0
)
RETURNS TABLE (
    total_count          BIGINT,
    id                   INTEGER,
    organization_id      VARCHAR,
    provider             VARCHAR,
    name                 VARCHAR,
    enabled              BOOLEAN,
    config               JSONB,
    has_secret_fields    BOOLEAN,
    last_test_at         TIMESTAMPTZ,
    last_test_status     VARCHAR,
    last_delivery_at     TIMESTAMPTZ,
    last_delivery_status VARCHAR,
    consecutive_failures INTEGER,
    last_success_at      TIMESTAMPTZ,
    last_failure_at      TIMESTAMPTZ,
    auto_disabled_at     TIMESTAMPTZ,
    disable_reason       VARCHAR,
    quiet_hours_start    INTEGER,
    quiet_hours_end      INTEGER,
    quiet_hours_tz       VARCHAR,
    created_at           TIMESTAMPTZ,
    updated_at           TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT e.*
        FROM notifications.channels e
        WHERE e.organization_id = p_organization_id
          AND (p_provider IS NULL OR e.provider = p_provider)
          AND (p_enabled IS NULL OR e.enabled = p_enabled)
          AND (p_query IS NULL OR e.name ILIKE '%' || p_query || '%')
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        e.id, e.organization_id, e.provider, e.name, e.enabled, e.config,
        (s.endpoint_id IS NOT NULL) AS has_secret_fields,
        e.last_test_at, e.last_test_status,
        e.last_delivery_at, e.last_delivery_status,
        e.consecutive_failures, e.last_success_at, e.last_failure_at,
        e.auto_disabled_at, e.disable_reason,
        e.quiet_hours_start, e.quiet_hours_end, e.quiet_hours_tz,
        e.created_at, e.updated_at
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY name ASC
        LIMIT p_limit OFFSET p_offset
    ) e ON TRUE
    LEFT JOIN notifications.channel_secrets s ON s.endpoint_id = e.id;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_channel_create(
    p_organization_id     VARCHAR,
    p_provider            VARCHAR,
    p_name                VARCHAR,
    p_enabled             BOOLEAN DEFAULT TRUE,
    p_config              JSONB   DEFAULT '{}'::jsonb,
    p_quiet_hours_start   INTEGER DEFAULT NULL,
    p_quiet_hours_end     INTEGER DEFAULT NULL,
    p_quiet_hours_tz      VARCHAR DEFAULT 'UTC'
)
RETURNS TABLE (
    id                    INTEGER,
    organization_id       VARCHAR,
    provider              VARCHAR,
    name                  VARCHAR,
    enabled               BOOLEAN,
    config                JSONB,
    has_secret_fields     BOOLEAN,
    last_test_at          TIMESTAMPTZ,
    last_test_status      VARCHAR,
    last_delivery_at      TIMESTAMPTZ,
    last_delivery_status  VARCHAR,
    consecutive_failures  INTEGER,
    last_success_at       TIMESTAMPTZ,
    last_failure_at       TIMESTAMPTZ,
    auto_disabled_at      TIMESTAMPTZ,
    disable_reason        VARCHAR,
    quiet_hours_start     INTEGER,
    quiet_hours_end       INTEGER,
    quiet_hours_tz        VARCHAR,
    created_at            TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
    v_id INTEGER;
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);
    INSERT INTO notifications.channels (
        organization_id, provider, name, enabled, config,
        quiet_hours_start, quiet_hours_end, quiet_hours_tz
    )
    VALUES (
        p_organization_id, p_provider, p_name,
        COALESCE(p_enabled, TRUE), COALESCE(p_config, '{}'::jsonb),
        p_quiet_hours_start, p_quiet_hours_end,
        COALESCE(p_quiet_hours_tz, 'UTC')
    )
    RETURNING id INTO v_id;
    RETURN QUERY SELECT * FROM notifications.fn_channel_get(p_organization_id, v_id);
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_channel_update(
    p_organization_id     VARCHAR,
    p_id                  INTEGER,
    p_name                VARCHAR DEFAULT NULL,
    p_enabled             BOOLEAN DEFAULT NULL,
    p_config              JSONB   DEFAULT NULL,
    p_quiet_hours_start   INTEGER DEFAULT NULL,
    p_quiet_hours_end     INTEGER DEFAULT NULL,
    p_quiet_hours_tz      VARCHAR DEFAULT NULL,
    p_clear_quiet_hours   BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    id                    INTEGER,
    organization_id       VARCHAR,
    provider              VARCHAR,
    name                  VARCHAR,
    enabled               BOOLEAN,
    config                JSONB,
    has_secret_fields     BOOLEAN,
    last_test_at          TIMESTAMPTZ,
    last_test_status      VARCHAR,
    last_delivery_at      TIMESTAMPTZ,
    last_delivery_status  VARCHAR,
    consecutive_failures  INTEGER,
    last_success_at       TIMESTAMPTZ,
    last_failure_at       TIMESTAMPTZ,
    auto_disabled_at      TIMESTAMPTZ,
    disable_reason        VARCHAR,
    quiet_hours_start     INTEGER,
    quiet_hours_end       INTEGER,
    quiet_hours_tz        VARCHAR,
    created_at            TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE notifications.channels e
    SET
        name               = COALESCE(p_name, e.name),
        enabled            = COALESCE(p_enabled, e.enabled),
        config             = COALESCE(p_config, e.config),
        quiet_hours_start  = CASE WHEN p_clear_quiet_hours THEN NULL
                                  ELSE COALESCE(p_quiet_hours_start, e.quiet_hours_start) END,
        quiet_hours_end    = CASE WHEN p_clear_quiet_hours THEN NULL
                                  ELSE COALESCE(p_quiet_hours_end, e.quiet_hours_end) END,
        quiet_hours_tz     = COALESCE(p_quiet_hours_tz, e.quiet_hours_tz),
        updated_at         = NOW()
    WHERE e.id = p_id AND e.organization_id = p_organization_id;
    RETURN QUERY SELECT * FROM notifications.fn_channel_get(p_organization_id, p_id);
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_channel_delete(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (id INTEGER)
LANGUAGE sql
AS $$
    DELETE FROM notifications.channels
    WHERE channels.id = p_id
      AND channels.organization_id = p_organization_id
    RETURNING channels.id;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_channel_secret_get(
    p_endpoint_id INTEGER
)
RETURNS TABLE (
    endpoint_id        INTEGER,
    encrypted_payload  TEXT,
    updated_at         TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT s.endpoint_id, s.encrypted_payload, s.updated_at
    FROM notifications.channel_secrets s
    WHERE s.endpoint_id = p_endpoint_id;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_channel_secret_set(
    p_endpoint_id          INTEGER,
    p_encrypted_payload    TEXT,
    p_expected_updated_at  TIMESTAMPTZ DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_affected INTEGER;
BEGIN
    IF p_encrypted_payload IS NULL OR LENGTH(TRIM(p_encrypted_payload)) = 0 THEN
        DELETE FROM notifications.channel_secrets
        WHERE endpoint_id = p_endpoint_id
          AND (p_expected_updated_at IS NULL OR updated_at = p_expected_updated_at);
        GET DIAGNOSTICS v_affected = ROW_COUNT;
        RETURN v_affected > 0 OR p_expected_updated_at IS NULL;
    END IF;

    IF p_expected_updated_at IS NULL THEN
        INSERT INTO notifications.channel_secrets (endpoint_id, encrypted_payload, updated_at)
        VALUES (p_endpoint_id, p_encrypted_payload, NOW())
        ON CONFLICT (endpoint_id) DO NOTHING;
        GET DIAGNOSTICS v_affected = ROW_COUNT;
        RETURN v_affected > 0;
    END IF;

    UPDATE notifications.channel_secrets
    SET encrypted_payload = p_encrypted_payload, updated_at = NOW()
    WHERE endpoint_id = p_endpoint_id
      AND updated_at = p_expected_updated_at;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RETURN v_affected > 0;
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_channel_set_test_result(
    p_organization_id VARCHAR,
    p_id              INTEGER,
    p_status          VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE notifications.channels
    SET last_test_at = NOW(), last_test_status = p_status, updated_at = NOW()
    WHERE id = p_id AND organization_id = p_organization_id;
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_channel_record_delivery(
    p_endpoint_id       INTEGER,
    p_status            VARCHAR,
    p_autooff_threshold INTEGER DEFAULT 10
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_auto_disabled BOOLEAN := FALSE;
BEGIN
    IF p_status = 'succeeded' THEN
        UPDATE notifications.channels
        SET last_delivery_at = NOW(),
            last_delivery_status = 'success',
            last_success_at = NOW(),
            consecutive_failures = 0,
            auto_disabled_at = NULL,
            disable_reason = NULL,
            updated_at = NOW()
        WHERE id = p_endpoint_id;
    ELSE
        UPDATE notifications.channels
        SET last_delivery_at = NOW(),
            last_delivery_status = 'failed',
            last_failure_at = NOW(),
            consecutive_failures = consecutive_failures + 1,
            auto_disabled_at = CASE
                WHEN consecutive_failures + 1 >= p_autooff_threshold THEN COALESCE(auto_disabled_at, NOW())
                ELSE auto_disabled_at
            END,
            disable_reason = CASE
                WHEN consecutive_failures + 1 >= p_autooff_threshold THEN 'too_many_failures'
                ELSE disable_reason
            END,
            enabled = CASE
                WHEN consecutive_failures + 1 >= p_autooff_threshold THEN FALSE
                ELSE enabled
            END,
            updated_at = NOW()
        WHERE id = p_endpoint_id
        RETURNING auto_disabled_at IS NOT NULL INTO v_auto_disabled;
    END IF;
    RETURN COALESCE(v_auto_disabled, FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_channel_reset_health(
    p_id              INTEGER,
    p_organization_id VARCHAR,
    p_re_enable       BOOLEAN DEFAULT TRUE
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
    UPDATE notifications.channels
    SET consecutive_failures = 0,
        auto_disabled_at     = NULL,
        disable_reason       = NULL,
        enabled              = CASE WHEN p_re_enable THEN TRUE ELSE enabled END,
        updated_at           = NOW()
    WHERE id = p_id AND organization_id = p_organization_id
    RETURNING TRUE;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_channel_quiet_hours_until(
    p_endpoint_id INTEGER
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_end       INTEGER;
    v_tz        VARCHAR;
    v_now_local TIMESTAMP;
    v_end_local TIMESTAMP;
BEGIN
    SELECT quiet_hours_end, quiet_hours_tz
      INTO v_end, v_tz
      FROM notifications.channels
     WHERE id = p_endpoint_id;

    IF v_end IS NULL OR v_tz IS NULL THEN
        RETURN NULL;
    END IF;

    v_now_local := NOW() AT TIME ZONE v_tz;
    v_end_local := date_trunc('day', v_now_local) + make_interval(hours => v_end);
    IF v_end_local <= v_now_local THEN
        v_end_local := v_end_local + INTERVAL '1 day';
    END IF;
    RETURN v_end_local AT TIME ZONE v_tz;
END;
$$;

DROP FUNCTION IF EXISTS notifications.fn_delivery_job_claim(INTEGER);
CREATE FUNCTION notifications.fn_delivery_job_claim(
    p_id INTEGER
)
RETURNS TABLE (
    id                INTEGER,
    organization_id   VARCHAR,
    alert_id          INTEGER,
    inbox_item_id     INTEGER,
    endpoint_id       INTEGER,
    provider          VARCHAR,
    endpoint_name     VARCHAR,
    endpoint_enabled  BOOLEAN,
    endpoint_config   JSONB,
    attempt_count     INTEGER,
    in_quiet_hours    BOOLEAN,
    auto_disabled     BOOLEAN
)
LANGUAGE sql
AS $$
    WITH claimed AS (
        UPDATE notifications.delivery_jobs j
        SET state = 'processing', processing_started_at = NOW()
        WHERE j.id = (
            SELECT id
            FROM notifications.delivery_jobs
            WHERE id = p_id AND state = 'queued'
            FOR UPDATE SKIP LOCKED
        )
        RETURNING j.*
    )
    SELECT
        c.id, c.organization_id, c.alert_id, c.inbox_item_id, c.endpoint_id,
        e.provider, e.name AS endpoint_name, e.enabled AS endpoint_enabled,
        e.config AS endpoint_config, c.attempt_count,
        notifications.fn_endpoint_in_quiet_hours(
            e.quiet_hours_start, e.quiet_hours_end, e.quiet_hours_tz
        ) AS in_quiet_hours,
        (e.auto_disabled_at IS NOT NULL) AS auto_disabled
    FROM claimed c
    JOIN notifications.channels e ON e.id = c.endpoint_id;
$$;

DROP FUNCTION IF EXISTS notifications.fn_delivery_job_record_attempt(
    INTEGER, VARCHAR, INTEGER, VARCHAR, TEXT, BOOLEAN, INTEGER
);
CREATE FUNCTION notifications.fn_delivery_job_record_attempt(
    p_job_id            INTEGER,
    p_state             VARCHAR,
    p_http_status       INTEGER DEFAULT NULL,
    p_provider_code     VARCHAR DEFAULT NULL,
    p_error_message     TEXT    DEFAULT NULL,
    p_final_failure     BOOLEAN DEFAULT FALSE,
    p_autooff_threshold INTEGER DEFAULT 10
)
RETURNS TABLE (
    job_id          INTEGER,
    attempt_id      INTEGER,
    job_state       VARCHAR,
    attempt_count   INTEGER,
    endpoint_id     INTEGER,
    auto_disabled   BOOLEAN
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
    v_endpoint_id   INTEGER;
    v_attempt_id    INTEGER;
    v_next_state    VARCHAR;
    v_count         INTEGER;
    v_auto_disabled BOOLEAN := FALSE;
BEGIN
    SELECT delivery_jobs.endpoint_id INTO v_endpoint_id
    FROM notifications.delivery_jobs
    WHERE id = p_job_id;
    IF v_endpoint_id IS NULL THEN
        RAISE EXCEPTION 'delivery_job % not found', p_job_id USING ERRCODE = '02000';
    END IF;

    INSERT INTO notifications.delivery_attempts (
        job_id, endpoint_id, state, http_status, provider_code, error_message
    )
    VALUES (p_job_id, v_endpoint_id, p_state, p_http_status, p_provider_code, p_error_message)
    RETURNING id INTO v_attempt_id;

    v_next_state := CASE
        WHEN p_state = 'succeeded'                  THEN 'succeeded'
        WHEN p_state = 'failed' AND p_final_failure THEN 'dead_letter'
        ELSE 'queued'
    END;

    UPDATE notifications.delivery_jobs
    SET attempt_count         = attempt_count + 1,
        state                 = v_next_state,
        processing_started_at = NULL,
        completed_at          = CASE WHEN v_next_state IN ('succeeded','dead_letter')
                                     THEN NOW() ELSE completed_at END
    WHERE id = p_job_id
    RETURNING attempt_count INTO v_count;

    IF v_next_state IN ('succeeded','dead_letter') THEN
        v_auto_disabled := notifications.fn_channel_record_delivery(
            v_endpoint_id,
            CASE WHEN v_next_state = 'succeeded' THEN 'succeeded' ELSE 'failed' END,
            p_autooff_threshold
        );
    END IF;

    RETURN QUERY SELECT p_job_id, v_attempt_id, v_next_state, v_count, v_endpoint_id, v_auto_disabled;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_delivery_job_record_attempt(
    INTEGER, VARCHAR, INTEGER, VARCHAR, TEXT, BOOLEAN, INTEGER
);
DROP FUNCTION IF EXISTS notifications.fn_delivery_job_claim(INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_channel_quiet_hours_until(INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_channel_reset_health(INTEGER, VARCHAR, BOOLEAN);
DROP FUNCTION IF EXISTS notifications.fn_channel_record_delivery(INTEGER, VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_channel_set_test_result(VARCHAR, INTEGER, VARCHAR);
DROP FUNCTION IF EXISTS notifications.fn_channel_secret_set(INTEGER, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS notifications.fn_channel_secret_get(INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_channel_delete(VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_channel_update(VARCHAR, INTEGER, VARCHAR, BOOLEAN, JSONB, INTEGER, INTEGER, VARCHAR, BOOLEAN);
DROP FUNCTION IF EXISTS notifications.fn_channel_create(VARCHAR, VARCHAR, VARCHAR, BOOLEAN, JSONB, INTEGER, INTEGER, VARCHAR);
DROP FUNCTION IF EXISTS notifications.fn_channel_list(VARCHAR, VARCHAR, BOOLEAN, VARCHAR, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_channel_get(VARCHAR, INTEGER);

ALTER TABLE notifications.channel_secrets RENAME TO integration_endpoint_secrets;
ALTER TABLE notifications.channels RENAME TO integration_endpoints;

CREATE TABLE notifications.channels (
    id                    SERIAL PRIMARY KEY,
    organization_id       VARCHAR NOT NULL REFERENCES organization.profiles(id) ON DELETE CASCADE,
    integration_endpoint_id INTEGER REFERENCES notifications.integration_endpoints(id) ON DELETE SET NULL,
    name                  VARCHAR NOT NULL,
    type                  VARCHAR NOT NULL,
    config                JSONB NOT NULL DEFAULT '{}'::jsonb,
    secret_version        INTEGER NOT NULL DEFAULT 0,
    verification_status   VARCHAR NOT NULL DEFAULT 'unverified',
    disabled_reason       VARCHAR,
    last_delivery_status  VARCHAR,
    last_delivery_at      TIMESTAMPTZ,
    last_failure_at       TIMESTAMPTZ,
    last_failure_message  TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ,
    CONSTRAINT channels_type_valid CHECK (
        type IN (
            'email_smtp',
            'generic_webhook',
            'slack_webhook',
            'teams_workflow_webhook',
            'telegram_bot',
            'in_app'
        )
    ),
    CONSTRAINT channels_verification_status_valid CHECK (
        verification_status IN ('unverified', 'verified', 'failed')
    ),
    CONSTRAINT channels_last_delivery_status_valid CHECK (
        last_delivery_status IS NULL OR last_delivery_status IN ('success', 'failed')
    ),
    CONSTRAINT channels_secret_version_non_negative CHECK (secret_version >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS channels_name_by_org
    ON notifications.channels (organization_id, LOWER(name));
CREATE INDEX IF NOT EXISTS channels_integration_endpoint_idx
    ON notifications.channels (integration_endpoint_id);

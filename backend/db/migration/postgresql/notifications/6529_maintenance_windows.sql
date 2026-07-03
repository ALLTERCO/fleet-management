--------------UP
-- Maintenance windows. Scope-targeted, time-bounded suppression of
-- alert delivery. Phase 4 SuppressionEvaluator consults this table
-- alongside silences, mute_windows, quiet_hours, and inhibition rules.

CREATE TABLE IF NOT EXISTS notifications.maintenance_windows (
    id                BIGSERIAL    PRIMARY KEY,
    organization_id   VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    scope_type        VARCHAR(20)  NOT NULL CHECK (scope_type IN (
        'device','device_group','location','tag','org'
    )),
    scope_ids         JSONB        NOT NULL DEFAULT '[]'::jsonb,
    starts_at         TIMESTAMPTZ  NOT NULL,
    ends_at           TIMESTAMPTZ  NOT NULL,
    -- RFC 5545 RRULE subset (FREQ + INTERVAL + BYDAY + UNTIL/COUNT).
    -- Engine evaluates start/end as the FIRST occurrence; recurrence
    -- expansion happens at suppression-check time.
    recurrence_rule   TEXT,
    reason            VARCHAR(500),
    created_by        VARCHAR(255) NOT NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ,
    CONSTRAINT maintenance_windows_time_order CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS maintenance_windows_org_active_idx
    ON notifications.maintenance_windows (organization_id, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS maintenance_windows_scope_idx
    ON notifications.maintenance_windows USING GIN (scope_ids);

CREATE OR REPLACE FUNCTION notifications.fn_maintenance_window_create(
    p_organization_id  VARCHAR,
    p_scope_type       VARCHAR,
    p_scope_ids        JSONB,
    p_starts_at        TIMESTAMPTZ,
    p_ends_at          TIMESTAMPTZ,
    p_recurrence_rule  TEXT,
    p_reason           VARCHAR,
    p_created_by       VARCHAR
)
RETURNS TABLE (
    id              BIGINT,
    organization_id VARCHAR,
    scope_type      VARCHAR,
    scope_ids       JSONB,
    starts_at       TIMESTAMPTZ,
    ends_at         TIMESTAMPTZ,
    recurrence_rule TEXT,
    reason          VARCHAR,
    created_by      VARCHAR,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    INSERT INTO notifications.maintenance_windows
        (organization_id, scope_type, scope_ids, starts_at, ends_at,
         recurrence_rule, reason, created_by)
    VALUES
        (p_organization_id, p_scope_type, COALESCE(p_scope_ids, '[]'::jsonb),
         p_starts_at, p_ends_at, p_recurrence_rule, p_reason, p_created_by)
    RETURNING
        id, organization_id, scope_type, scope_ids, starts_at, ends_at,
        recurrence_rule, reason, created_by, created_at, updated_at;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_maintenance_window_list(
    p_organization_id  VARCHAR,
    p_active_at        TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    id              BIGINT,
    organization_id VARCHAR,
    scope_type      VARCHAR,
    scope_ids       JSONB,
    starts_at       TIMESTAMPTZ,
    ends_at         TIMESTAMPTZ,
    recurrence_rule TEXT,
    reason          VARCHAR,
    created_by      VARCHAR,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT
        w.id, w.organization_id, w.scope_type, w.scope_ids, w.starts_at,
        w.ends_at, w.recurrence_rule, w.reason, w.created_by,
        w.created_at, w.updated_at
    FROM notifications.maintenance_windows w
    WHERE w.organization_id = p_organization_id
      AND (
          p_active_at IS NULL
          OR (
              -- Non-recurring: simple in-window check.
              (w.recurrence_rule IS NULL
               AND w.starts_at <= p_active_at
               AND w.ends_at > p_active_at)
              -- Recurring: window of first occurrence may be past, but
              -- recurrence might re-arm later. Filter at the app layer
              -- via expand_rrule(); SQL just returns rows that COULD be active.
              OR (w.recurrence_rule IS NOT NULL AND w.ends_at > p_active_at)
          )
      )
    ORDER BY w.starts_at ASC;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_maintenance_window_delete(
    p_organization_id  VARCHAR,
    p_id               BIGINT
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
    WITH deleted AS (
        DELETE FROM notifications.maintenance_windows
         WHERE organization_id = p_organization_id AND id = p_id
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM deleted);
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_maintenance_window_delete(VARCHAR, BIGINT);
DROP FUNCTION IF EXISTS notifications.fn_maintenance_window_list(VARCHAR, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS notifications.fn_maintenance_window_create(
    VARCHAR, VARCHAR, JSONB, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, VARCHAR, VARCHAR
);
DROP TABLE IF EXISTS notifications.maintenance_windows;

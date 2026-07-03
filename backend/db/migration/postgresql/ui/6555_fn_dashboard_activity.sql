--------------UP
-- Append (CQS: pure DO, no return) writes one row; list (pure ANSWER)
-- reads recent rows. One function per use-case.

CREATE OR REPLACE FUNCTION ui.fn_dashboard_activity_append(
    p_dashboard_id    INTEGER,
    p_organization_id VARCHAR,
    p_actor_user_id   VARCHAR,
    p_event_kind      VARCHAR,
    p_detail          JSONB
)
RETURNS VOID
LANGUAGE sql
AS $$
    INSERT INTO ui.dashboard_activity_log (
        dashboard_id, organization_id, actor_user_id, event_kind, detail
    )
    VALUES (
        p_dashboard_id,
        p_organization_id,
        p_actor_user_id,
        p_event_kind,
        COALESCE(p_detail, '{}'::jsonb)
    );
$$;

CREATE OR REPLACE FUNCTION ui.fn_dashboard_activity_list(
    p_dashboard_id INTEGER,
    p_limit        INTEGER DEFAULT 20
)
RETURNS TABLE (
    id              BIGINT,
    dashboard_id    INTEGER,
    organization_id VARCHAR,
    actor_user_id   VARCHAR,
    event_kind      VARCHAR,
    detail          JSONB,
    occurred_at     TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT
        id, dashboard_id, organization_id, actor_user_id,
        event_kind, detail, occurred_at
    FROM ui.dashboard_activity_log
    WHERE dashboard_id = p_dashboard_id
    ORDER BY occurred_at DESC, id DESC
    LIMIT GREATEST(LEAST(COALESCE(p_limit, 20), 200), 1);
$$;

--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_activity_list(INTEGER, INTEGER);
DROP FUNCTION IF EXISTS ui.fn_dashboard_activity_append(
    INTEGER, VARCHAR, VARCHAR, VARCHAR, JSONB
);

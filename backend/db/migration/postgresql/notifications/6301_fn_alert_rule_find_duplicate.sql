--------------UP
-- Find a rule in the same org whose spec_hash matches the given inputs.
-- Returns the existing rule id (+ its current name) or nothing.
-- Optional p_exclude_id lets an Update call check for duplicates other
-- than itself.
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_find_duplicate(
    p_organization_id   VARCHAR,
    p_kind              VARCHAR,
    p_severity          VARCHAR,
    p_scope             JSONB,
    p_config            JSONB,
    p_dedupe_window_sec INTEGER,
    p_cooldown_sec      INTEGER,
    p_exclude_id        INTEGER DEFAULT NULL
)
RETURNS TABLE (
    id   INTEGER,
    name VARCHAR
)
LANGUAGE sql
STABLE
AS $$
    SELECT r.id, r.name
    FROM notifications.alert_rules r
    WHERE r.organization_id = p_organization_id
      AND r.spec_hash = md5(
              p_kind                        || '|' ||
              p_severity                    || '|' ||
              p_scope::text                 || '|' ||
              p_config::text                || '|' ||
              p_dedupe_window_sec::text     || '|' ||
              p_cooldown_sec::text
          )
      AND (p_exclude_id IS NULL OR r.id <> p_exclude_id)
    ORDER BY r.id
    LIMIT 1;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_find_duplicate(
    VARCHAR, VARCHAR, VARCHAR, JSONB, JSONB, INTEGER, INTEGER, INTEGER
);

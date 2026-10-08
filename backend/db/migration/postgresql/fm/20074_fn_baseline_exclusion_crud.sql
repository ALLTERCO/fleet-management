--------------UP
-- Org-scoped persistence for the operator's baseline exclusions. Save and
-- delete return the affected values in the same statement so the audit layer
-- never races another writer while collecting its before/after evidence.
SET search_path TO public;

CREATE OR REPLACE FUNCTION fm.fn_list_baseline_exclusions(
    p_org VARCHAR(120)
)
RETURNS TABLE (
    id BIGINT,
    organization_id VARCHAR(120),
    from_day TEXT,
    to_day TEXT,
    reason VARCHAR(200),
    created_by VARCHAR(120),
    created_at TEXT
)
LANGUAGE sql STABLE
AS $$
    SELECT x.id,
           x.organization_id,
           to_char(x.from_day, 'YYYY-MM-DD'),
           to_char(x.to_day, 'YYYY-MM-DD'),
           x.reason,
           x.created_by,
           to_char(
               x.created_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
           )
      FROM fm.baseline_exclusion x
     WHERE x.organization_id = p_org
     ORDER BY x.from_day, x.id;
$$;

CREATE OR REPLACE FUNCTION fm.fn_save_baseline_exclusion(
    p_id BIGINT,
    p_org VARCHAR(120),
    p_from_day DATE,
    p_to_day DATE,
    p_reason VARCHAR(200),
    p_created_by VARCHAR(120)
)
RETURNS TABLE (before_row JSONB, after_row JSONB)
LANGUAGE plpgsql
AS $$
DECLARE
    v_before JSONB;
    v_after JSONB;
BEGIN
    IF p_id IS NULL THEN
        INSERT INTO fm.baseline_exclusion AS x (
            organization_id,
            from_day,
            to_day,
            reason,
            created_by
        )
        VALUES (p_org, p_from_day, p_to_day, p_reason, p_created_by)
        RETURNING to_jsonb(x) INTO v_after;
    ELSE
        SELECT to_jsonb(x)
          INTO v_before
          FROM fm.baseline_exclusion x
         WHERE x.id = p_id
           AND x.organization_id = p_org
         FOR UPDATE;

        IF NOT FOUND THEN
            RETURN;
        END IF;

        UPDATE fm.baseline_exclusion AS x
           SET from_day = p_from_day,
               to_day = p_to_day,
               reason = p_reason
         WHERE x.id = p_id
           AND x.organization_id = p_org
        RETURNING to_jsonb(x) INTO v_after;
    END IF;

    RETURN QUERY SELECT v_before, v_after;
END;
$$;

CREATE OR REPLACE FUNCTION fm.fn_delete_baseline_exclusion(
    p_id BIGINT,
    p_org VARCHAR(120)
)
RETURNS TABLE (removed_row JSONB)
LANGUAGE sql
AS $$
    DELETE FROM fm.baseline_exclusion AS x
     WHERE x.id = p_id
       AND x.organization_id = p_org
    RETURNING to_jsonb(x);
$$;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_delete_baseline_exclusion(BIGINT, VARCHAR);
DROP FUNCTION IF EXISTS fm.fn_save_baseline_exclusion(
    BIGINT, VARCHAR, DATE, DATE, VARCHAR, VARCHAR
);
DROP FUNCTION IF EXISTS fm.fn_list_baseline_exclusions(VARCHAR);

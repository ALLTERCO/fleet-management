--------------UP
CREATE OR REPLACE FUNCTION organization.fn_try_normalize_subject_reference(
    p_organization_id VARCHAR,
    p_subject_type    VARCHAR,
    p_subject_id      VARCHAR
)
RETURNS TABLE (
    device_id     INTEGER,
    subject_id    VARCHAR,
    entity_suffix VARCHAR
)
LANGUAGE plpgsql
STABLE
STRICT
AS $$
BEGIN
    RETURN QUERY
    SELECT ref.device_id, ref.subject_id, ref.entity_suffix
      FROM organization.fn_normalize_subject_reference(
          p_organization_id, p_subject_type, p_subject_id
      ) ref;
EXCEPTION
    WHEN SQLSTATE '22023' THEN
        RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_group_remove_members_batch(
    p_organization_id VARCHAR,
    p_group_id        INTEGER,
    p_subject_types   VARCHAR[],
    p_subject_ids     VARCHAR[]
)
RETURNS TABLE (group_id INTEGER, subject_type VARCHAR, subject_id VARCHAR)
LANGUAGE plpgsql
AS $$
BEGIN
    IF array_length(p_subject_types, 1) IS DISTINCT FROM array_length(p_subject_ids, 1) THEN
        RAISE EXCEPTION 'subject_types/subject_ids length mismatch'
            USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM organization.groups g
         WHERE g.id = p_group_id
           AND g.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'group_id % not found in organization %',
            p_group_id, p_organization_id USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    WITH normalized AS (
        SELECT input.subject_type,
               ref.device_id,
               ref.subject_id,
               ref.entity_suffix
          FROM unnest(p_subject_types, p_subject_ids)
               AS input(subject_type, subject_id)
          CROSS JOIN LATERAL organization.fn_try_normalize_subject_reference(
              p_organization_id, input.subject_type, input.subject_id
          ) ref
    ), deleted AS (
        DELETE FROM organization.group_members gm
        USING normalized n
         WHERE gm.organization_id = p_organization_id
           AND gm.group_id = p_group_id
           AND gm.subject_type = n.subject_type
           AND gm.subject_id IS NOT DISTINCT FROM n.subject_id
           AND gm.device_id IS NOT DISTINCT FROM n.device_id
           AND gm.entity_suffix IS NOT DISTINCT FROM n.entity_suffix
        RETURNING gm.group_id, gm.subject_type, gm.subject_id,
                  gm.device_id, gm.entity_suffix
    )
    SELECT d.group_id,
           d.subject_type,
           CASE
               WHEN d.subject_type = 'device' THEN dl.external_id
               WHEN d.subject_type = 'entity' AND d.device_id IS NOT NULL
                   THEN d.device_id::TEXT || '_' || d.entity_suffix
               ELSE d.subject_id
           END::VARCHAR
      FROM deleted d
      LEFT JOIN device.list dl ON dl.id = d.device_id;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_tag_unassign_batch(
    p_organization_id VARCHAR,
    p_tag_id          INTEGER,
    p_subject_types   VARCHAR[],
    p_subject_ids     VARCHAR[]
)
RETURNS TABLE (tag_id INTEGER, subject_type VARCHAR, subject_id VARCHAR)
LANGUAGE plpgsql
AS $$
BEGIN
    IF array_length(p_subject_types, 1) IS DISTINCT FROM array_length(p_subject_ids, 1) THEN
        RAISE EXCEPTION 'subject_types/subject_ids length mismatch'
            USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM organization.tags t
         WHERE t.id = p_tag_id
           AND t.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'tag_id % not found in organization %',
            p_tag_id, p_organization_id USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    WITH normalized AS (
        SELECT input.subject_type,
               ref.device_id,
               ref.subject_id,
               ref.entity_suffix
          FROM unnest(p_subject_types, p_subject_ids)
               AS input(subject_type, subject_id)
          CROSS JOIN LATERAL organization.fn_try_normalize_subject_reference(
              p_organization_id, input.subject_type, input.subject_id
          ) ref
    ), deleted AS (
        DELETE FROM organization.tag_assignments ta
        USING normalized n
         WHERE ta.organization_id = p_organization_id
           AND ta.tag_id = p_tag_id
           AND ta.subject_type = n.subject_type
           AND ta.subject_id IS NOT DISTINCT FROM n.subject_id
           AND ta.device_id IS NOT DISTINCT FROM n.device_id
           AND ta.entity_suffix IS NOT DISTINCT FROM n.entity_suffix
        RETURNING ta.tag_id, ta.subject_type, ta.subject_id,
                  ta.device_id, ta.entity_suffix
    )
    SELECT d.tag_id,
           d.subject_type,
           CASE
               WHEN d.subject_type = 'device' THEN dl.external_id
               WHEN d.subject_type = 'entity' AND d.device_id IS NOT NULL
                   THEN d.device_id::TEXT || '_' || d.entity_suffix
               ELSE d.subject_id
           END::VARCHAR
      FROM deleted d
      LEFT JOIN device.list dl ON dl.id = d.device_id;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_location_remove_assignment(
    p_organization_id VARCHAR,
    p_subject_type    VARCHAR,
    p_subject_id      VARCHAR
)
RETURNS TABLE (
    organization_id VARCHAR,
    subject_type VARCHAR,
    subject_id VARCHAR,
    location_id INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    WITH normalized AS (
        SELECT * FROM organization.fn_try_normalize_subject_reference(
            p_organization_id, p_subject_type, p_subject_id
        )
    ), deleted AS (
        DELETE FROM organization.location_assignments la
        USING normalized n
         WHERE la.organization_id = p_organization_id
           AND la.subject_type = p_subject_type
           AND la.subject_id IS NOT DISTINCT FROM n.subject_id
           AND la.device_id IS NOT DISTINCT FROM n.device_id
           AND la.entity_suffix IS NOT DISTINCT FROM n.entity_suffix
        RETURNING la.organization_id, la.subject_type, la.subject_id,
                  la.device_id, la.entity_suffix, la.location_id,
                  la.created_at, la.updated_at
    )
    SELECT d.organization_id,
           d.subject_type,
           CASE
               WHEN d.subject_type = 'device' THEN dl.external_id
               WHEN d.subject_type = 'entity' AND d.device_id IS NOT NULL
                   THEN d.device_id::TEXT || '_' || d.entity_suffix
               ELSE d.subject_id
           END::VARCHAR,
           d.location_id, d.created_at, d.updated_at
      FROM deleted d
      LEFT JOIN device.list dl ON dl.id = d.device_id;
$$;

--------------DOWN
CREATE OR REPLACE FUNCTION organization.fn_group_remove_members_batch(
    p_organization_id VARCHAR,
    p_group_id        INTEGER,
    p_subject_types   VARCHAR[],
    p_subject_ids     VARCHAR[]
)
RETURNS TABLE (group_id INTEGER, subject_type VARCHAR, subject_id VARCHAR)
LANGUAGE plpgsql
AS $$
BEGIN
    IF array_length(p_subject_types, 1) IS DISTINCT FROM array_length(p_subject_ids, 1) THEN
        RAISE EXCEPTION 'subject_types/subject_ids length mismatch'
            USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM organization.groups g
         WHERE g.id = p_group_id
           AND g.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'group_id % not found in organization %',
            p_group_id, p_organization_id USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    WITH normalized AS (
        SELECT input.subject_type,
               ref.device_id,
               ref.subject_id,
               ref.entity_suffix
          FROM unnest(p_subject_types, p_subject_ids)
               AS input(subject_type, subject_id)
          CROSS JOIN LATERAL organization.fn_normalize_subject_reference(
              p_organization_id, input.subject_type, input.subject_id
          ) ref
    ), deleted AS (
        DELETE FROM organization.group_members gm
        USING normalized n
         WHERE gm.organization_id = p_organization_id
           AND gm.group_id = p_group_id
           AND gm.subject_type = n.subject_type
           AND gm.subject_id IS NOT DISTINCT FROM n.subject_id
           AND gm.device_id IS NOT DISTINCT FROM n.device_id
           AND gm.entity_suffix IS NOT DISTINCT FROM n.entity_suffix
        RETURNING gm.group_id, gm.subject_type, gm.subject_id,
                  gm.device_id, gm.entity_suffix
    )
    SELECT d.group_id,
           d.subject_type,
           CASE
               WHEN d.subject_type = 'device' THEN dl.external_id
               WHEN d.subject_type = 'entity' AND d.device_id IS NOT NULL
                   THEN d.device_id::TEXT || '_' || d.entity_suffix
               ELSE d.subject_id
           END::VARCHAR
      FROM deleted d
      LEFT JOIN device.list dl ON dl.id = d.device_id;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_tag_unassign_batch(
    p_organization_id VARCHAR,
    p_tag_id          INTEGER,
    p_subject_types   VARCHAR[],
    p_subject_ids     VARCHAR[]
)
RETURNS TABLE (tag_id INTEGER, subject_type VARCHAR, subject_id VARCHAR)
LANGUAGE plpgsql
AS $$
BEGIN
    IF array_length(p_subject_types, 1) IS DISTINCT FROM array_length(p_subject_ids, 1) THEN
        RAISE EXCEPTION 'subject_types/subject_ids length mismatch'
            USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM organization.tags t
         WHERE t.id = p_tag_id
           AND t.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'tag_id % not found in organization %',
            p_tag_id, p_organization_id USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    WITH normalized AS (
        SELECT input.subject_type,
               ref.device_id,
               ref.subject_id,
               ref.entity_suffix
          FROM unnest(p_subject_types, p_subject_ids)
               AS input(subject_type, subject_id)
          CROSS JOIN LATERAL organization.fn_normalize_subject_reference(
              p_organization_id, input.subject_type, input.subject_id
          ) ref
    ), deleted AS (
        DELETE FROM organization.tag_assignments ta
        USING normalized n
         WHERE ta.organization_id = p_organization_id
           AND ta.tag_id = p_tag_id
           AND ta.subject_type = n.subject_type
           AND ta.subject_id IS NOT DISTINCT FROM n.subject_id
           AND ta.device_id IS NOT DISTINCT FROM n.device_id
           AND ta.entity_suffix IS NOT DISTINCT FROM n.entity_suffix
        RETURNING ta.tag_id, ta.subject_type, ta.subject_id,
                  ta.device_id, ta.entity_suffix
    )
    SELECT d.tag_id,
           d.subject_type,
           CASE
               WHEN d.subject_type = 'device' THEN dl.external_id
               WHEN d.subject_type = 'entity' AND d.device_id IS NOT NULL
                   THEN d.device_id::TEXT || '_' || d.entity_suffix
               ELSE d.subject_id
           END::VARCHAR
      FROM deleted d
      LEFT JOIN device.list dl ON dl.id = d.device_id;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_location_remove_assignment(
    p_organization_id VARCHAR,
    p_subject_type    VARCHAR,
    p_subject_id      VARCHAR
)
RETURNS TABLE (
    organization_id VARCHAR,
    subject_type VARCHAR,
    subject_id VARCHAR,
    location_id INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    WITH normalized AS (
        SELECT * FROM organization.fn_normalize_subject_reference(
            p_organization_id, p_subject_type, p_subject_id
        )
    ), deleted AS (
        DELETE FROM organization.location_assignments la
        USING normalized n
         WHERE la.organization_id = p_organization_id
           AND la.subject_type = p_subject_type
           AND la.subject_id IS NOT DISTINCT FROM n.subject_id
           AND la.device_id IS NOT DISTINCT FROM n.device_id
           AND la.entity_suffix IS NOT DISTINCT FROM n.entity_suffix
        RETURNING la.organization_id, la.subject_type, la.subject_id,
                  la.device_id, la.entity_suffix, la.location_id,
                  la.created_at, la.updated_at
    )
    SELECT d.organization_id,
           d.subject_type,
           CASE
               WHEN d.subject_type = 'device' THEN dl.external_id
               WHEN d.subject_type = 'entity' AND d.device_id IS NOT NULL
                   THEN d.device_id::TEXT || '_' || d.entity_suffix
               ELSE d.subject_id
           END::VARCHAR,
           d.location_id, d.created_at, d.updated_at
      FROM deleted d
      LEFT JOIN device.list dl ON dl.id = d.device_id;
$$;

DROP FUNCTION organization.fn_try_normalize_subject_reference(
    VARCHAR, VARCHAR, VARCHAR
);

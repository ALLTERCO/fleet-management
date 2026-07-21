--------------UP
-- LINT-IGNORE: additive-only — PostgreSQL requires DROP before replacing this table-returning function.
DROP FUNCTION IF EXISTS organization.fn_group_add_members_batch(
    VARCHAR, INTEGER, VARCHAR[], VARCHAR[]
);
CREATE OR REPLACE FUNCTION organization.fn_group_add_members_batch(
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
    ), inserted AS (
        INSERT INTO organization.group_members AS gm (
            organization_id, group_id, subject_type,
            subject_id, device_id, entity_suffix
        )
        SELECT p_organization_id, p_group_id, n.subject_type,
               n.subject_id, n.device_id, n.entity_suffix
          FROM normalized n
        ON CONFLICT ON CONSTRAINT group_member_pk DO NOTHING
        RETURNING gm.group_id, gm.subject_type, gm.subject_id,
                  gm.device_id, gm.entity_suffix
    )
    SELECT i.group_id,
           i.subject_type,
           CASE
               WHEN i.subject_type = 'device' THEN dl.external_id
               WHEN i.subject_type = 'entity' AND i.device_id IS NOT NULL
                   THEN i.device_id::TEXT || '_' || i.entity_suffix
               ELSE i.subject_id
           END::VARCHAR
      FROM inserted i
      LEFT JOIN device.list dl ON dl.id = i.device_id;
END;
$$;

-- LINT-IGNORE: additive-only — PostgreSQL requires DROP before replacing this table-returning function.
DROP FUNCTION IF EXISTS organization.fn_group_remove_members_batch(
    VARCHAR, INTEGER, VARCHAR[], VARCHAR[]
);
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

CREATE OR REPLACE FUNCTION organization.fn_group_list_members(
    p_organization_id VARCHAR,
    p_group_id        INTEGER,
    p_subject_type    VARCHAR DEFAULT NULL,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0
)
RETURNS TABLE (
    total_count BIGINT,
    group_id INTEGER,
    subject_type VARCHAR,
    subject_id VARCHAR,
    created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    WITH filtered AS (
        SELECT gm.group_id,
               gm.subject_type,
               CASE
                   WHEN gm.subject_type = 'device' THEN dl.external_id
                   WHEN gm.subject_type = 'entity' AND gm.device_id IS NOT NULL
                       THEN gm.device_id::TEXT || '_' || gm.entity_suffix
                   ELSE gm.subject_id
               END::VARCHAR AS subject_id,
               gm.created_at
          FROM organization.group_members gm
          LEFT JOIN device.list dl ON dl.id = gm.device_id
         WHERE gm.organization_id = p_organization_id
           AND gm.group_id = p_group_id
           AND (p_subject_type IS NULL OR gm.subject_type = p_subject_type)
    ), total AS (SELECT count(*) AS c FROM filtered)
    SELECT total.c, page.group_id, page.subject_type,
           page.subject_id, page.created_at
      FROM total
      LEFT JOIN LATERAL (
          SELECT * FROM filtered
           ORDER BY subject_type, subject_id
           LIMIT p_limit OFFSET p_offset
      ) page ON TRUE;
$$;

-- LINT-IGNORE: additive-only — PostgreSQL requires DROP before replacing this table-returning function.
DROP FUNCTION IF EXISTS organization.fn_group_find_by_member(
    VARCHAR, VARCHAR, VARCHAR
);
CREATE OR REPLACE FUNCTION organization.fn_group_find_by_member(
    p_organization_id VARCHAR,
    p_subject_type    VARCHAR,
    p_subject_id      VARCHAR
)
RETURNS TABLE (id INTEGER, name VARCHAR)
LANGUAGE sql
STABLE
AS $$
    SELECT g.id, g.name
      FROM organization.fn_normalize_subject_reference(
               p_organization_id, p_subject_type, p_subject_id
           ) ref
      JOIN organization.group_members gm
        ON gm.organization_id = p_organization_id
       AND gm.subject_type = p_subject_type
       AND gm.subject_id IS NOT DISTINCT FROM ref.subject_id
       AND gm.device_id IS NOT DISTINCT FROM ref.device_id
       AND gm.entity_suffix IS NOT DISTINCT FROM ref.entity_suffix
      JOIN organization.groups g ON g.id = gm.group_id
     ORDER BY g.name;
$$;

-- LINT-IGNORE: additive-only — PostgreSQL requires DROP before replacing this table-returning function.
DROP FUNCTION IF EXISTS organization.fn_group_device_memberships(
    VARCHAR, INTEGER[]
);
CREATE OR REPLACE FUNCTION organization.fn_group_device_memberships(
    p_organization_id VARCHAR,
    p_group_ids       INTEGER[] DEFAULT NULL
)
RETURNS TABLE (group_id INTEGER, subject_id VARCHAR)
LANGUAGE sql
STABLE
AS $$
    SELECT gm.group_id, dl.external_id
      FROM organization.group_members gm
      JOIN device.list dl
        ON dl.organization_id = gm.organization_id
       AND dl.id = gm.device_id
     WHERE gm.organization_id = p_organization_id
       AND gm.subject_type = 'device'
       AND (p_group_ids IS NULL OR gm.group_id = ANY(p_group_ids));
$$;

-- LINT-IGNORE: additive-only — PostgreSQL requires DROP before replacing this table-returning function.
DROP FUNCTION IF EXISTS organization.fn_tag_assign_batch(
    VARCHAR, INTEGER, VARCHAR[], VARCHAR[]
);
CREATE OR REPLACE FUNCTION organization.fn_tag_assign_batch(
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
    ), inserted AS (
        INSERT INTO organization.tag_assignments AS ta (
            organization_id, tag_id, subject_type,
            subject_id, device_id, entity_suffix
        )
        SELECT p_organization_id, p_tag_id, n.subject_type,
               n.subject_id, n.device_id, n.entity_suffix
          FROM normalized n
        ON CONFLICT ON CONSTRAINT tag_assignment_pk DO NOTHING
        RETURNING ta.tag_id, ta.subject_type, ta.subject_id,
                  ta.device_id, ta.entity_suffix
    )
    SELECT i.tag_id,
           i.subject_type,
           CASE
               WHEN i.subject_type = 'device' THEN dl.external_id
               WHEN i.subject_type = 'entity' AND i.device_id IS NOT NULL
                   THEN i.device_id::TEXT || '_' || i.entity_suffix
               ELSE i.subject_id
           END::VARCHAR
      FROM inserted i
      LEFT JOIN device.list dl ON dl.id = i.device_id;
END;
$$;

-- LINT-IGNORE: additive-only — PostgreSQL requires DROP before replacing this table-returning function.
DROP FUNCTION IF EXISTS organization.fn_tag_unassign_batch(
    VARCHAR, INTEGER, VARCHAR[], VARCHAR[]
);
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

CREATE OR REPLACE FUNCTION organization.fn_tag_list_assignments(
    p_organization_id VARCHAR,
    p_tag_id          INTEGER,
    p_subject_type    VARCHAR DEFAULT NULL,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0
)
RETURNS TABLE (
    total_count BIGINT,
    tag_id INTEGER,
    subject_type VARCHAR,
    subject_id VARCHAR,
    created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    WITH filtered AS (
        SELECT ta.tag_id,
               ta.subject_type,
               CASE
                   WHEN ta.subject_type = 'device' THEN dl.external_id
                   WHEN ta.subject_type = 'entity' AND ta.device_id IS NOT NULL
                       THEN ta.device_id::TEXT || '_' || ta.entity_suffix
                   ELSE ta.subject_id
               END::VARCHAR AS subject_id,
               ta.created_at
          FROM organization.tag_assignments ta
          LEFT JOIN device.list dl ON dl.id = ta.device_id
         WHERE ta.organization_id = p_organization_id
           AND ta.tag_id = p_tag_id
           AND (p_subject_type IS NULL OR ta.subject_type = p_subject_type)
    ), total AS (SELECT count(*) AS c FROM filtered)
    SELECT total.c, page.tag_id, page.subject_type,
           page.subject_id, page.created_at
      FROM total
      LEFT JOIN LATERAL (
          SELECT * FROM filtered
           ORDER BY subject_type, subject_id
           LIMIT p_limit OFFSET p_offset
      ) page ON TRUE;
$$;

CREATE OR REPLACE FUNCTION organization.fn_tag_ids_for_subject(
    p_organization_id VARCHAR,
    p_subject_type    VARCHAR,
    p_subject_id      VARCHAR
)
RETURNS TABLE (tag_id INTEGER)
LANGUAGE sql
STABLE
AS $$
    SELECT ta.tag_id
      FROM organization.fn_normalize_subject_reference(
               p_organization_id, p_subject_type, p_subject_id
           ) ref
      JOIN organization.tag_assignments ta
        ON ta.organization_id = p_organization_id
       AND ta.subject_type = p_subject_type
       AND ta.subject_id IS NOT DISTINCT FROM ref.subject_id
       AND ta.device_id IS NOT DISTINCT FROM ref.device_id
       AND ta.entity_suffix IS NOT DISTINCT FROM ref.entity_suffix
     ORDER BY ta.tag_id;
$$;

CREATE OR REPLACE FUNCTION organization.fn_location_set_assignment(
    p_organization_id VARCHAR,
    p_subject_type    VARCHAR,
    p_subject_id      VARCHAR,
    p_location_id     INTEGER
)
RETURNS TABLE (
    organization_id VARCHAR,
    subject_type VARCHAR,
    subject_id VARCHAR,
    location_id INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);
    IF NOT EXISTS (
        SELECT 1 FROM organization.locations l
         WHERE l.id = p_location_id
           AND l.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'location_id % not found in organization %',
            p_location_id, p_organization_id USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    WITH normalized AS (
        SELECT * FROM organization.fn_normalize_subject_reference(
            p_organization_id, p_subject_type, p_subject_id
        )
    ), changed AS (
        INSERT INTO organization.location_assignments AS la (
            organization_id, subject_type, subject_id,
            device_id, entity_suffix, location_id
        )
        SELECT p_organization_id, p_subject_type, n.subject_id,
               n.device_id, n.entity_suffix, p_location_id
          FROM normalized n
        ON CONFLICT ON CONSTRAINT location_assignment_pk
        DO UPDATE SET location_id = EXCLUDED.location_id, updated_at = now()
        RETURNING la.organization_id, la.subject_type, la.subject_id,
                  la.device_id, la.entity_suffix, la.location_id,
                  la.created_at, la.updated_at
    )
    SELECT c.organization_id,
           c.subject_type,
           CASE
               WHEN c.subject_type = 'device' THEN dl.external_id
               WHEN c.subject_type = 'entity' AND c.device_id IS NOT NULL
                   THEN c.device_id::TEXT || '_' || c.entity_suffix
               ELSE c.subject_id
           END::VARCHAR,
           c.location_id, c.created_at, c.updated_at
      FROM changed c
      LEFT JOIN device.list dl ON dl.id = c.device_id;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_location_set_assignment_batch(
    p_organization_id VARCHAR,
    p_location_id     INTEGER,
    p_subject_types   VARCHAR[],
    p_subject_ids     VARCHAR[]
)
RETURNS TABLE (
    organization_id VARCHAR,
    subject_type VARCHAR,
    subject_id VARCHAR,
    location_id INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF array_length(p_subject_types, 1) IS DISTINCT FROM array_length(p_subject_ids, 1) THEN
        RAISE EXCEPTION 'subject_types/subject_ids length mismatch'
            USING ERRCODE = '22023';
    END IF;
    PERFORM organization.fn_profile_ensure(p_organization_id);
    IF NOT EXISTS (
        SELECT 1 FROM organization.locations l
         WHERE l.id = p_location_id
           AND l.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'location_id % not found in organization %',
            p_location_id, p_organization_id USING ERRCODE = '22023';
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
    ), changed AS (
        INSERT INTO organization.location_assignments AS la (
            organization_id, subject_type, subject_id,
            device_id, entity_suffix, location_id
        )
        SELECT p_organization_id, n.subject_type, n.subject_id,
               n.device_id, n.entity_suffix, p_location_id
          FROM normalized n
        ON CONFLICT ON CONSTRAINT location_assignment_pk
        DO UPDATE SET location_id = EXCLUDED.location_id, updated_at = now()
        RETURNING la.organization_id, la.subject_type, la.subject_id,
                  la.device_id, la.entity_suffix, la.location_id,
                  la.created_at, la.updated_at
    )
    SELECT c.organization_id,
           c.subject_type,
           CASE
               WHEN c.subject_type = 'device' THEN dl.external_id
               WHEN c.subject_type = 'entity' AND c.device_id IS NOT NULL
                   THEN c.device_id::TEXT || '_' || c.entity_suffix
               ELSE c.subject_id
           END::VARCHAR,
           c.location_id, c.created_at, c.updated_at
      FROM changed c
      LEFT JOIN device.list dl ON dl.id = c.device_id;
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

-- LINT-IGNORE: additive-only — PostgreSQL requires DROP to change defaults safely.
DROP FUNCTION IF EXISTS organization.fn_location_list_assignments(
    VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, INTEGER, INTEGER[], INTEGER[]
);
CREATE FUNCTION organization.fn_location_list_assignments(
    p_organization_id VARCHAR,
    p_subject_type    VARCHAR DEFAULT NULL,
    p_subject_id      VARCHAR DEFAULT NULL,
    p_location_id     INTEGER DEFAULT NULL,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0,
    p_allowed_ids     INTEGER[] DEFAULT NULL,
    p_location_ids    INTEGER[] DEFAULT NULL
)
RETURNS TABLE (
    total_count BIGINT,
    organization_id VARCHAR,
    subject_type VARCHAR,
    subject_id VARCHAR,
    location_id INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    WITH filtered AS (
        SELECT la.organization_id,
               la.subject_type,
               CASE
                   WHEN la.subject_type = 'device' THEN dl.external_id
                   WHEN la.subject_type = 'entity' AND la.device_id IS NOT NULL
                       THEN la.device_id::TEXT || '_' || la.entity_suffix
                   ELSE la.subject_id
               END::VARCHAR AS subject_id,
               la.location_id,
               la.created_at,
               la.updated_at
          FROM organization.location_assignments la
          LEFT JOIN device.list dl ON dl.id = la.device_id
         WHERE la.organization_id = p_organization_id
           AND (p_subject_type IS NULL OR la.subject_type = p_subject_type)
           AND (p_location_id IS NULL OR la.location_id = p_location_id)
           AND (p_location_ids IS NULL OR la.location_id = ANY(p_location_ids))
           AND (p_allowed_ids IS NULL OR la.location_id = ANY(p_allowed_ids))
    ), selected AS (
        SELECT * FROM filtered
         WHERE p_subject_id IS NULL OR subject_id = p_subject_id
    ), total AS (SELECT count(*) AS c FROM selected)
    SELECT total.c, page.organization_id, page.subject_type,
           page.subject_id, page.location_id,
           page.created_at, page.updated_at
      FROM total
      LEFT JOIN LATERAL (
          SELECT * FROM selected
           ORDER BY subject_type, subject_id
           LIMIT p_limit OFFSET p_offset
      ) page ON TRUE;
$$;

CREATE OR REPLACE FUNCTION organization.fn_device_memberships(
    p_organization_id VARCHAR
)
RETURNS TABLE (
    subject_id VARCHAR,
    group_ids INTEGER[],
    location_id INTEGER,
    tag_ids INTEGER[],
    tag_keys VARCHAR[]
)
LANGUAGE sql
STABLE
AS $$
    WITH g AS (
        SELECT gm.device_id,
               array_agg(gm.group_id ORDER BY gm.group_id) AS group_ids
          FROM organization.group_members gm
         WHERE gm.organization_id = p_organization_id
           AND gm.subject_type = 'device'
         GROUP BY gm.device_id
    ), l AS (
        SELECT la.device_id, la.location_id
          FROM organization.location_assignments la
         WHERE la.organization_id = p_organization_id
           AND la.subject_type = 'device'
    ), t AS (
        SELECT ta.device_id,
               array_agg(ta.tag_id ORDER BY ta.tag_id) AS tag_ids,
               array_agg(tags.key ORDER BY ta.tag_id) AS tag_keys
          FROM organization.tag_assignments ta
          JOIN organization.tags tags
            ON tags.organization_id = ta.organization_id
           AND tags.id = ta.tag_id
         WHERE ta.organization_id = p_organization_id
           AND ta.subject_type = 'device'
         GROUP BY ta.device_id
    ), subjects AS (
        SELECT device_id FROM g
        UNION SELECT device_id FROM l
        UNION SELECT device_id FROM t
    )
    SELECT dl.external_id,
           coalesce(g.group_ids, ARRAY[]::INTEGER[]),
           l.location_id,
           coalesce(t.tag_ids, ARRAY[]::INTEGER[]),
           coalesce(t.tag_keys, ARRAY[]::VARCHAR[])
      FROM subjects s
      JOIN device.list dl
        ON dl.organization_id = p_organization_id
       AND dl.id = s.device_id
      LEFT JOIN g ON g.device_id = s.device_id
      LEFT JOIN l ON l.device_id = s.device_id
      LEFT JOIN t ON t.device_id = s.device_id;
$$;

CREATE OR REPLACE FUNCTION organization.fn_group_list_activity(
    p_organization_id VARCHAR,
    p_group_id INTEGER,
    p_from TIMESTAMPTZ DEFAULT NULL,
    p_to TIMESTAMPTZ DEFAULT NULL,
    p_event_types TEXT[] DEFAULT NULL,
    p_include_descendants BOOLEAN DEFAULT TRUE,
    p_limit INTEGER DEFAULT 200,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    audit_id INTEGER,
    ts TIMESTAMPTZ,
    event_type VARCHAR,
    username VARCHAR,
    shelly_id VARCHAR,
    shelly_ids TEXT[],
    method VARCHAR,
    params JSONB,
    success BOOLEAN,
    error_message TEXT,
    total_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE tree AS (
        SELECT g.id, 1 AS depth
          FROM organization.groups g
         WHERE g.organization_id = p_organization_id
           AND g.id = p_group_id
        UNION ALL
        SELECT child.id, tree.depth + 1
          FROM organization.groups child
          JOIN tree ON child.parent_group_id = tree.id
         WHERE child.organization_id = p_organization_id
           AND tree.depth < 64
           AND p_include_descendants
    ), ids_array AS (
        SELECT array_agg(DISTINCT dl.external_id)::TEXT[] AS ids
          FROM organization.group_members gm
          JOIN device.list dl
            ON dl.organization_id = gm.organization_id
           AND dl.id = gm.device_id
         WHERE gm.organization_id = p_organization_id
           AND gm.subject_type = 'device'
           AND gm.group_id IN (SELECT id FROM tree)
    ), matched AS (
        SELECT audit.*
          FROM logging.audit_log audit, ids_array scoped
         WHERE (p_from IS NULL OR audit.ts >= p_from)
           AND (p_to IS NULL OR audit.ts <= p_to)
           AND (p_event_types IS NULL OR audit.event_type = ANY(p_event_types))
           AND cardinality(scoped.ids) > 0
           AND (
               audit.shelly_id = ANY(scoped.ids)
               OR audit.shelly_ids && scoped.ids
           )
    ), counted AS (SELECT count(*)::BIGINT AS total_count FROM matched)
    SELECT matched.id,
           matched.ts,
           matched.event_type,
           matched.username,
           matched.shelly_id,
           matched.shelly_ids,
           matched.method,
           matched.params,
           matched.success,
           matched.error_message,
           counted.total_count
      FROM matched CROSS JOIN counted
     ORDER BY matched.ts DESC, matched.id DESC
     LIMIT p_limit OFFSET p_offset;
$$;

--------------DOWN
CREATE OR REPLACE FUNCTION organization.fn_group_add_members_batch(
    p_organization_id VARCHAR,
    p_group_id INTEGER,
    p_subject_types VARCHAR[],
    p_subject_ids VARCHAR[]
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
         WHERE g.id = p_group_id AND g.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'group_id % not found in organization %',
            p_group_id, p_organization_id USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    INSERT INTO organization.group_members AS gm (
        organization_id, group_id, subject_type, subject_id
    )
    SELECT p_organization_id, p_group_id, input.subject_type, input.subject_id
      FROM unnest(p_subject_types, p_subject_ids)
           AS input(subject_type, subject_id)
    ON CONFLICT DO NOTHING
    RETURNING gm.group_id, gm.subject_type, gm.subject_id;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_group_remove_members_batch(
    p_organization_id VARCHAR,
    p_group_id INTEGER,
    p_subject_types VARCHAR[],
    p_subject_ids VARCHAR[]
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
         WHERE g.id = p_group_id AND g.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'group_id % not found in organization %',
            p_group_id, p_organization_id USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    DELETE FROM organization.group_members gm
    USING unnest(p_subject_types, p_subject_ids)
          AS input(subject_type, subject_id)
     WHERE gm.organization_id = p_organization_id
       AND gm.group_id = p_group_id
       AND gm.subject_type = input.subject_type
       AND gm.subject_id = input.subject_id
    RETURNING gm.group_id, gm.subject_type, gm.subject_id;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_group_list_members(
    p_organization_id VARCHAR,
    p_group_id INTEGER,
    p_subject_type VARCHAR DEFAULT NULL,
    p_limit INTEGER DEFAULT 200,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    total_count BIGINT, group_id INTEGER, subject_type VARCHAR,
    subject_id VARCHAR, created_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT gm.group_id, gm.subject_type, gm.subject_id, gm.created_at
          FROM organization.group_members gm
         WHERE gm.organization_id = p_organization_id
           AND gm.group_id = p_group_id
           AND (p_subject_type IS NULL OR gm.subject_type = p_subject_type)
    ), total AS (SELECT count(*) AS c FROM filtered)
    SELECT total.c, page.group_id, page.subject_type,
           page.subject_id, page.created_at
      FROM total
      LEFT JOIN LATERAL (
          SELECT * FROM filtered
           ORDER BY subject_type, subject_id
           LIMIT p_limit OFFSET p_offset
      ) page ON TRUE;
$$;

CREATE OR REPLACE FUNCTION organization.fn_group_find_by_member(
    p_organization_id VARCHAR,
    p_subject_type VARCHAR,
    p_subject_id VARCHAR
)
RETURNS TABLE (id INTEGER, name VARCHAR)
LANGUAGE sql
AS $$
    SELECT g.id, g.name
      FROM organization.groups g
      JOIN organization.group_members gm ON gm.group_id = g.id
     WHERE gm.organization_id = p_organization_id
       AND gm.subject_type = p_subject_type
       AND gm.subject_id = p_subject_id
     ORDER BY g.name;
$$;

CREATE OR REPLACE FUNCTION organization.fn_group_device_memberships(
    p_organization_id VARCHAR,
    p_group_ids INTEGER[] DEFAULT NULL
)
RETURNS TABLE (group_id INTEGER, subject_id VARCHAR)
LANGUAGE sql
AS $$
    SELECT gm.group_id, gm.subject_id
      FROM organization.group_members gm
     WHERE gm.organization_id = p_organization_id
       AND gm.subject_type = 'device'
       AND (p_group_ids IS NULL OR gm.group_id = ANY(p_group_ids));
$$;

CREATE OR REPLACE FUNCTION organization.fn_tag_assign_batch(
    p_organization_id VARCHAR,
    p_tag_id INTEGER,
    p_subject_types VARCHAR[],
    p_subject_ids VARCHAR[]
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
         WHERE t.id = p_tag_id AND t.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'tag_id % not found in organization %',
            p_tag_id, p_organization_id USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    INSERT INTO organization.tag_assignments AS ta (
        organization_id, tag_id, subject_type, subject_id
    )
    SELECT p_organization_id, p_tag_id, input.subject_type, input.subject_id
      FROM unnest(p_subject_types, p_subject_ids)
           AS input(subject_type, subject_id)
    ON CONFLICT DO NOTHING
    RETURNING ta.tag_id, ta.subject_type, ta.subject_id;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_tag_unassign_batch(
    p_organization_id VARCHAR,
    p_tag_id INTEGER,
    p_subject_types VARCHAR[],
    p_subject_ids VARCHAR[]
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
         WHERE t.id = p_tag_id AND t.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'tag_id % not found in organization %',
            p_tag_id, p_organization_id USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    DELETE FROM organization.tag_assignments ta
    USING unnest(p_subject_types, p_subject_ids)
          AS input(subject_type, subject_id)
     WHERE ta.organization_id = p_organization_id
       AND ta.tag_id = p_tag_id
       AND ta.subject_type = input.subject_type
       AND ta.subject_id = input.subject_id
    RETURNING ta.tag_id, ta.subject_type, ta.subject_id;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_tag_list_assignments(
    p_organization_id VARCHAR,
    p_tag_id INTEGER,
    p_subject_type VARCHAR DEFAULT NULL,
    p_limit INTEGER DEFAULT 200,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    total_count BIGINT, tag_id INTEGER, subject_type VARCHAR,
    subject_id VARCHAR, created_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT ta.tag_id, ta.subject_type, ta.subject_id, ta.created_at
          FROM organization.tag_assignments ta
         WHERE ta.organization_id = p_organization_id
           AND ta.tag_id = p_tag_id
           AND (p_subject_type IS NULL OR ta.subject_type = p_subject_type)
    ), total AS (SELECT count(*) AS c FROM filtered)
    SELECT total.c, page.tag_id, page.subject_type,
           page.subject_id, page.created_at
      FROM total
      LEFT JOIN LATERAL (
          SELECT * FROM filtered
           ORDER BY subject_type, subject_id
           LIMIT p_limit OFFSET p_offset
      ) page ON TRUE;
$$;

CREATE OR REPLACE FUNCTION organization.fn_tag_ids_for_subject(
    p_organization_id VARCHAR,
    p_subject_type VARCHAR,
    p_subject_id VARCHAR
)
RETURNS TABLE (tag_id INTEGER)
LANGUAGE sql
AS $$
    SELECT ta.tag_id
      FROM organization.tag_assignments ta
     WHERE ta.organization_id = p_organization_id
       AND ta.subject_type = p_subject_type
       AND ta.subject_id = p_subject_id
     ORDER BY ta.tag_id;
$$;

CREATE OR REPLACE FUNCTION organization.fn_location_set_assignment(
    p_organization_id VARCHAR,
    p_subject_type VARCHAR,
    p_subject_id VARCHAR,
    p_location_id INTEGER
)
RETURNS TABLE (
    organization_id VARCHAR, subject_type VARCHAR, subject_id VARCHAR,
    location_id INTEGER, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);
    IF NOT EXISTS (
        SELECT 1 FROM organization.locations l
         WHERE l.id = p_location_id AND l.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'location_id % not found in organization %',
            p_location_id, p_organization_id USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    INSERT INTO organization.location_assignments AS la (
        organization_id, subject_type, subject_id, location_id
    ) VALUES (
        p_organization_id, p_subject_type, p_subject_id, p_location_id
    )
    ON CONFLICT ON CONSTRAINT location_assignment_pk
    DO UPDATE SET location_id = EXCLUDED.location_id, updated_at = now()
    RETURNING la.organization_id, la.subject_type, la.subject_id,
              la.location_id, la.created_at, la.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_location_set_assignment_batch(
    p_organization_id VARCHAR,
    p_location_id INTEGER,
    p_subject_types VARCHAR[],
    p_subject_ids VARCHAR[]
)
RETURNS TABLE (
    organization_id VARCHAR, subject_type VARCHAR, subject_id VARCHAR,
    location_id INTEGER, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF array_length(p_subject_types, 1) IS DISTINCT FROM array_length(p_subject_ids, 1) THEN
        RAISE EXCEPTION 'subject_types/subject_ids length mismatch'
            USING ERRCODE = '22023';
    END IF;
    PERFORM organization.fn_profile_ensure(p_organization_id);
    IF NOT EXISTS (
        SELECT 1 FROM organization.locations l
         WHERE l.id = p_location_id AND l.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'location_id % not found in organization %',
            p_location_id, p_organization_id USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    INSERT INTO organization.location_assignments AS la (
        organization_id, subject_type, subject_id, location_id
    )
    SELECT p_organization_id, input.subject_type,
           input.subject_id, p_location_id
      FROM unnest(p_subject_types, p_subject_ids)
           AS input(subject_type, subject_id)
    ON CONFLICT ON CONSTRAINT location_assignment_pk
    DO UPDATE SET location_id = EXCLUDED.location_id, updated_at = now()
    RETURNING la.organization_id, la.subject_type, la.subject_id,
              la.location_id, la.created_at, la.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_location_remove_assignment(
    p_organization_id VARCHAR,
    p_subject_type VARCHAR,
    p_subject_id VARCHAR
)
RETURNS TABLE (
    organization_id VARCHAR, subject_type VARCHAR, subject_id VARCHAR,
    location_id INTEGER, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    DELETE FROM organization.location_assignments la
     WHERE la.organization_id = p_organization_id
       AND la.subject_type = p_subject_type
       AND la.subject_id = p_subject_id
    RETURNING la.organization_id, la.subject_type, la.subject_id,
              la.location_id, la.created_at, la.updated_at;
$$;

-- LINT-IGNORE: additive-only — rollback restores the prior signature.
DROP FUNCTION IF EXISTS organization.fn_location_list_assignments(
    VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, INTEGER, INTEGER[], INTEGER[]
);
CREATE FUNCTION organization.fn_location_list_assignments(
    p_organization_id VARCHAR,
    p_subject_type VARCHAR DEFAULT NULL,
    p_subject_id VARCHAR DEFAULT NULL,
    p_location_id INTEGER DEFAULT NULL,
    p_limit INTEGER DEFAULT 200,
    p_offset INTEGER DEFAULT 0,
    p_allowed_ids INTEGER[] DEFAULT NULL,
    p_location_ids INTEGER[] DEFAULT NULL
)
RETURNS TABLE (
    total_count BIGINT, organization_id VARCHAR, subject_type VARCHAR,
    subject_id VARCHAR, location_id INTEGER,
    created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT la.organization_id, la.subject_type, la.subject_id,
               la.location_id, la.created_at, la.updated_at
          FROM organization.location_assignments la
         WHERE la.organization_id = p_organization_id
           AND (p_subject_type IS NULL OR la.subject_type = p_subject_type)
           AND (p_subject_id IS NULL OR la.subject_id = p_subject_id)
           AND (p_location_id IS NULL OR la.location_id = p_location_id)
           AND (p_location_ids IS NULL OR la.location_id = ANY(p_location_ids))
           AND (p_allowed_ids IS NULL OR la.location_id = ANY(p_allowed_ids))
    ), total AS (SELECT count(*) AS c FROM filtered)
    SELECT total.c, page.organization_id, page.subject_type,
           page.subject_id, page.location_id,
           page.created_at, page.updated_at
      FROM total
      LEFT JOIN LATERAL (
          SELECT * FROM filtered
           ORDER BY subject_type, subject_id
           LIMIT p_limit OFFSET p_offset
      ) page ON TRUE;
$$;

CREATE OR REPLACE FUNCTION organization.fn_device_memberships(
    p_organization_id VARCHAR
)
RETURNS TABLE (
    subject_id VARCHAR, group_ids INTEGER[], location_id INTEGER,
    tag_ids INTEGER[], tag_keys VARCHAR[]
)
LANGUAGE sql
AS $$
    WITH g AS (
        SELECT gm.subject_id,
               array_agg(gm.group_id ORDER BY gm.group_id) AS group_ids
          FROM organization.group_members gm
         WHERE gm.organization_id = p_organization_id
           AND gm.subject_type = 'device'
         GROUP BY gm.subject_id
    ), l AS (
        SELECT la.subject_id, la.location_id
          FROM organization.location_assignments la
         WHERE la.organization_id = p_organization_id
           AND la.subject_type = 'device'
    ), t AS (
        SELECT ta.subject_id,
               array_agg(ta.tag_id ORDER BY ta.tag_id) AS tag_ids,
               array_agg(tags.key ORDER BY ta.tag_id) AS tag_keys
          FROM organization.tag_assignments ta
          JOIN organization.tags tags
            ON tags.organization_id = ta.organization_id
           AND tags.id = ta.tag_id
         WHERE ta.organization_id = p_organization_id
           AND ta.subject_type = 'device'
         GROUP BY ta.subject_id
    ), subjects AS (
        SELECT subject_id FROM g
        UNION SELECT subject_id FROM l
        UNION SELECT subject_id FROM t
    )
    SELECT subjects.subject_id,
           coalesce(g.group_ids, ARRAY[]::INTEGER[]),
           l.location_id,
           coalesce(t.tag_ids, ARRAY[]::INTEGER[]),
           coalesce(t.tag_keys, ARRAY[]::VARCHAR[])
      FROM subjects
      LEFT JOIN g USING (subject_id)
      LEFT JOIN l USING (subject_id)
      LEFT JOIN t USING (subject_id);
$$;

CREATE OR REPLACE FUNCTION organization.fn_group_list_activity(
    p_organization_id VARCHAR,
    p_group_id INTEGER,
    p_from TIMESTAMPTZ DEFAULT NULL,
    p_to TIMESTAMPTZ DEFAULT NULL,
    p_event_types TEXT[] DEFAULT NULL,
    p_include_descendants BOOLEAN DEFAULT TRUE,
    p_limit INTEGER DEFAULT 200,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    audit_id INTEGER, ts TIMESTAMPTZ, event_type VARCHAR,
    username VARCHAR, shelly_id VARCHAR, shelly_ids TEXT[],
    method VARCHAR, params JSONB, success BOOLEAN,
    error_message TEXT, total_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE tree AS (
        SELECT g.id, 1 AS depth
          FROM organization.groups g
         WHERE g.organization_id = p_organization_id AND g.id = p_group_id
        UNION ALL
        SELECT child.id, tree.depth + 1
          FROM organization.groups child
          JOIN tree ON child.parent_group_id = tree.id
         WHERE child.organization_id = p_organization_id
           AND tree.depth < 64 AND p_include_descendants
    ), ids_array AS (
        SELECT array_agg(DISTINCT gm.subject_id)::TEXT[] AS ids
          FROM organization.group_members gm
         WHERE gm.organization_id = p_organization_id
           AND gm.subject_type = 'device'
           AND gm.group_id IN (SELECT id FROM tree)
    ), matched AS (
        SELECT audit.*
          FROM logging.audit_log audit, ids_array scoped
         WHERE (p_from IS NULL OR audit.ts >= p_from)
           AND (p_to IS NULL OR audit.ts <= p_to)
           AND (p_event_types IS NULL OR audit.event_type = ANY(p_event_types))
           AND cardinality(scoped.ids) > 0
           AND (
               audit.shelly_id = ANY(scoped.ids)
               OR audit.shelly_ids && scoped.ids
           )
    ), counted AS (SELECT count(*)::BIGINT AS total_count FROM matched)
    SELECT matched.id, matched.ts, matched.event_type, matched.username,
           matched.shelly_id, matched.shelly_ids, matched.method,
           matched.params, matched.success, matched.error_message,
           counted.total_count
      FROM matched CROSS JOIN counted
     ORDER BY matched.ts DESC, matched.id DESC
     LIMIT p_limit OFFSET p_offset;
$$;

--------------UP
-- Projected entity IDs can coincide while their stored membership identities differ.

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
               gm.subject_id AS storage_subject_id,
               gm.device_id AS storage_device_id,
               gm.entity_suffix AS storage_entity_suffix,
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
           ORDER BY subject_type, subject_id,
                    storage_device_id, storage_subject_id, storage_entity_suffix
           LIMIT p_limit OFFSET p_offset
      ) page ON TRUE
     ORDER BY page.subject_type, page.subject_id,
              page.storage_device_id, page.storage_subject_id, page.storage_entity_suffix;
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
               ta.subject_id AS storage_subject_id,
               ta.device_id AS storage_device_id,
               ta.entity_suffix AS storage_entity_suffix,
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
           ORDER BY subject_type, subject_id,
                    storage_device_id, storage_subject_id, storage_entity_suffix
           LIMIT p_limit OFFSET p_offset
      ) page ON TRUE
     ORDER BY page.subject_type, page.subject_id,
              page.storage_device_id, page.storage_subject_id, page.storage_entity_suffix;
$$;

CREATE OR REPLACE FUNCTION organization.fn_location_list_assignments(
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
               la.subject_id AS storage_subject_id,
               la.device_id AS storage_device_id,
               la.entity_suffix AS storage_entity_suffix,
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
           ORDER BY subject_type, subject_id,
                    storage_device_id, storage_subject_id, storage_entity_suffix
           LIMIT p_limit OFFSET p_offset
      ) page ON TRUE
     ORDER BY page.subject_type, page.subject_id,
              page.storage_device_id, page.storage_subject_id, page.storage_entity_suffix;
$$;

--------------DOWN

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

CREATE OR REPLACE FUNCTION organization.fn_location_list_assignments(
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

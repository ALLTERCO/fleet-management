--------------UP
-- Tag pictures: an optional image asset on a tag, same image-asset system
-- devices and groups already use (image_asset_id UUID). Threaded through
-- create/update/get/list so the tag editor can set it like color/icon.
ALTER TABLE organization.tags
    ADD COLUMN IF NOT EXISTS image_asset_id UUID;

-- ---- fn_tag_create ---------------------------------------------------------
DROP FUNCTION IF EXISTS organization.fn_tag_create(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB);
CREATE OR REPLACE FUNCTION organization.fn_tag_create(
    p_organization_id VARCHAR,
    p_key             VARCHAR,
    p_name            VARCHAR,
    p_description     VARCHAR DEFAULT NULL,
    p_color           VARCHAR DEFAULT NULL,
    p_icon            VARCHAR DEFAULT NULL,
    p_metadata        JSONB   DEFAULT '{}'::jsonb,
    p_image_asset_id  UUID    DEFAULT NULL
)
RETURNS TABLE (
    id              INTEGER,
    organization_id VARCHAR,
    key             VARCHAR,
    name            VARCHAR,
    description     VARCHAR,
    color           VARCHAR,
    icon            VARCHAR,
    metadata        JSONB,
    image_asset_id  UUID,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_row organization.tags%ROWTYPE;
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);

    INSERT INTO organization.tags (
        organization_id, key, name, description, color, icon, metadata,
        image_asset_id
    )
    VALUES (
        p_organization_id, p_key, p_name, p_description, p_color, p_icon,
        COALESCE(p_metadata, '{}'::jsonb), p_image_asset_id
    )
    RETURNING * INTO v_row;

    RETURN QUERY SELECT
        v_row.id, v_row.organization_id, v_row.key, v_row.name,
        v_row.description, v_row.color, v_row.icon, v_row.metadata,
        v_row.image_asset_id, v_row.created_at, v_row.updated_at;
END;
$$;

-- ---- fn_tag_update ---------------------------------------------------------
DROP FUNCTION IF EXISTS organization.fn_tag_update(
    VARCHAR, INTEGER, VARCHAR, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN, VARCHAR,
    BOOLEAN, JSONB);
CREATE OR REPLACE FUNCTION organization.fn_tag_update(
    p_organization_id      VARCHAR,
    p_id                   INTEGER,
    p_name                 VARCHAR DEFAULT NULL,
    p_description          VARCHAR DEFAULT NULL,
    p_clear_description    BOOLEAN DEFAULT FALSE,
    p_color                VARCHAR DEFAULT NULL,
    p_clear_color          BOOLEAN DEFAULT FALSE,
    p_icon                 VARCHAR DEFAULT NULL,
    p_clear_icon           BOOLEAN DEFAULT FALSE,
    p_metadata             JSONB   DEFAULT NULL,
    p_image_asset_id       UUID    DEFAULT NULL,
    p_clear_image_asset_id BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    id              INTEGER,
    organization_id VARCHAR,
    key             VARCHAR,
    name            VARCHAR,
    description     VARCHAR,
    color           VARCHAR,
    icon            VARCHAR,
    metadata        JSONB,
    image_asset_id  UUID,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    UPDATE organization.tags SET
        name        = COALESCE(p_name, tags.name),
        description = CASE
            WHEN p_clear_description THEN NULL
            WHEN p_description IS NOT NULL THEN p_description
            ELSE tags.description
        END,
        color       = CASE
            WHEN p_clear_color THEN NULL
            WHEN p_color IS NOT NULL THEN p_color
            ELSE tags.color
        END,
        icon        = CASE
            WHEN p_clear_icon THEN NULL
            WHEN p_icon IS NOT NULL THEN p_icon
            ELSE tags.icon
        END,
        metadata    = COALESCE(p_metadata, tags.metadata),
        image_asset_id = CASE
            WHEN p_clear_image_asset_id THEN NULL
            WHEN p_image_asset_id IS NOT NULL THEN p_image_asset_id
            ELSE tags.image_asset_id
        END,
        updated_at  = NOW()
    WHERE tags.id = p_id AND tags.organization_id = p_organization_id
    RETURNING tags.id, tags.organization_id, tags.key, tags.name,
              tags.description, tags.color, tags.icon, tags.metadata,
              tags.image_asset_id, tags.created_at, tags.updated_at;
$$;

-- ---- fn_tag_get ------------------------------------------------------------
DROP FUNCTION IF EXISTS organization.fn_tag_get(
    VARCHAR, INTEGER, BOOLEAN, VARCHAR[], INTEGER[], INTEGER[]);
CREATE OR REPLACE FUNCTION organization.fn_tag_get(
    p_organization_id       VARCHAR,
    p_id                    INTEGER,
    p_include_summary       BOOLEAN   DEFAULT NULL,
    p_allowed_device_ids    VARCHAR[] DEFAULT NULL,
    p_allowed_group_ids     INTEGER[] DEFAULT NULL,
    p_allowed_location_ids  INTEGER[] DEFAULT NULL
)
RETURNS TABLE (
    id              INTEGER,
    organization_id VARCHAR,
    key             VARCHAR,
    name            VARCHAR,
    description     VARCHAR,
    color           VARCHAR,
    icon            VARCHAR,
    metadata        JSONB,
    image_asset_id  UUID,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ,
    counts          JSONB
)
LANGUAGE sql
AS $$
    SELECT
        t.id, t.organization_id, t.key, t.name, t.description, t.color,
        t.icon, t.metadata, t.image_asset_id, t.created_at, t.updated_at,
        CASE WHEN p_include_summary THEN
            COALESCE(
                (SELECT jsonb_object_agg(subject_type, c)
                 FROM (
                     SELECT ta.subject_type, COUNT(*) AS c
                     FROM organization.tag_assignments ta
                     WHERE ta.tag_id = t.id
                       AND ta.organization_id = p_organization_id
                       AND (
                           ta.subject_type NOT IN ('device','entity','group','location')
                           OR (ta.subject_type = 'device'
                               AND (p_allowed_device_ids IS NULL
                                    OR ta.subject_id = ANY(p_allowed_device_ids)))
                           OR (ta.subject_type = 'entity'
                               AND organization.fn_entity_belongs_to_device(ta.subject_id, p_allowed_device_ids))
                           OR (ta.subject_type = 'group'
                               AND (p_allowed_group_ids IS NULL
                                    OR ta.subject_id IN (
                                        SELECT id::text FROM unnest(p_allowed_group_ids) AS x(id)
                                    )))
                           OR (ta.subject_type = 'location'
                               AND (p_allowed_location_ids IS NULL
                                    OR ta.subject_id IN (
                                        SELECT id::text FROM unnest(p_allowed_location_ids) AS x(id)
                                    )))
                       )
                     GROUP BY ta.subject_type
                 ) agg),
                '{}'::jsonb
            )
        END
    FROM organization.tags t
    WHERE t.id = p_id AND t.organization_id = p_organization_id;
$$;

-- ---- fn_tag_list -----------------------------------------------------------
DROP FUNCTION IF EXISTS organization.fn_tag_list(
    VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, VARCHAR, VARCHAR, BOOLEAN,
    VARCHAR[], INTEGER[], INTEGER[]);
CREATE OR REPLACE FUNCTION organization.fn_tag_list(
    p_organization_id       VARCHAR,
    p_query                 VARCHAR   DEFAULT NULL,
    p_key                   VARCHAR   DEFAULT NULL,
    p_limit                 INTEGER   DEFAULT 200,
    p_offset                INTEGER   DEFAULT 0,
    p_sort_by               VARCHAR   DEFAULT 'key',
    p_sort_dir              VARCHAR   DEFAULT 'asc',
    p_include_summary       BOOLEAN   DEFAULT NULL,
    p_allowed_device_ids    VARCHAR[] DEFAULT NULL,
    p_allowed_group_ids     INTEGER[] DEFAULT NULL,
    p_allowed_location_ids  INTEGER[] DEFAULT NULL
)
RETURNS TABLE (
    total_count     BIGINT,
    id              INTEGER,
    organization_id VARCHAR,
    key             VARCHAR,
    name            VARCHAR,
    description     VARCHAR,
    color           VARCHAR,
    icon            VARCHAR,
    metadata        JSONB,
    image_asset_id  UUID,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ,
    counts          JSONB
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT t.*
        FROM organization.tags t
        WHERE t.organization_id = p_organization_id
          AND (p_key IS NULL OR t.key = LOWER(p_key))
          AND (p_query IS NULL OR (
              t.name ILIKE '%' || p_query || '%'
              OR t.key  ILIKE '%' || p_query || '%'
          ))
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        f.id, f.organization_id, f.key, f.name, f.description, f.color,
        f.icon, f.metadata, f.image_asset_id, f.created_at, f.updated_at,
        CASE WHEN p_include_summary THEN
            COALESCE(
                (SELECT jsonb_object_agg(subject_type, c)
                 FROM (
                     SELECT ta.subject_type, COUNT(*) AS c
                     FROM organization.tag_assignments ta
                     WHERE ta.tag_id = f.id
                       AND ta.organization_id = p_organization_id
                       AND (
                           ta.subject_type NOT IN ('device','entity','group','location')
                           OR (ta.subject_type = 'device'
                               AND (p_allowed_device_ids IS NULL
                                    OR ta.subject_id = ANY(p_allowed_device_ids)))
                           OR (ta.subject_type = 'entity'
                               AND organization.fn_entity_belongs_to_device(ta.subject_id, p_allowed_device_ids))
                           OR (ta.subject_type = 'group'
                               AND (p_allowed_group_ids IS NULL
                                    OR ta.subject_id IN (
                                        SELECT id::text FROM unnest(p_allowed_group_ids) AS x(id)
                                    )))
                           OR (ta.subject_type = 'location'
                               AND (p_allowed_location_ids IS NULL
                                    OR ta.subject_id IN (
                                        SELECT id::text FROM unnest(p_allowed_location_ids) AS x(id)
                                    )))
                       )
                     GROUP BY ta.subject_type
                 ) agg),
                '{}'::jsonb
            )
        END
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY
            CASE WHEN p_sort_by = 'name'       AND p_sort_dir = 'asc'  THEN name       END ASC,
            CASE WHEN p_sort_by = 'name'       AND p_sort_dir = 'desc' THEN name       END DESC,
            CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'asc'  THEN created_at END ASC,
            CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'desc' THEN created_at END DESC,
            CASE WHEN p_sort_by = 'updated_at' AND p_sort_dir = 'asc'  THEN updated_at END ASC NULLS LAST,
            CASE WHEN p_sort_by = 'updated_at' AND p_sort_dir = 'desc' THEN updated_at END DESC NULLS LAST,
            CASE WHEN (p_sort_by NOT IN ('name','created_at','updated_at') OR p_sort_by IS NULL)
                      AND p_sort_dir = 'desc' THEN key END DESC,
            key ASC
        LIMIT p_limit OFFSET p_offset
    ) f ON TRUE;
$$;

--------------DOWN
-- Restore the pre-image function signatures, then drop the column.
DROP FUNCTION IF EXISTS organization.fn_tag_create(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, UUID);
DROP FUNCTION IF EXISTS organization.fn_tag_update(
    VARCHAR, INTEGER, VARCHAR, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN, VARCHAR,
    BOOLEAN, JSONB, UUID, BOOLEAN);
DROP FUNCTION IF EXISTS organization.fn_tag_get(
    VARCHAR, INTEGER, BOOLEAN, VARCHAR[], INTEGER[], INTEGER[]);
DROP FUNCTION IF EXISTS organization.fn_tag_list(
    VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, VARCHAR, VARCHAR, BOOLEAN,
    VARCHAR[], INTEGER[], INTEGER[]);

CREATE OR REPLACE FUNCTION organization.fn_tag_create(
    p_organization_id VARCHAR,
    p_key             VARCHAR,
    p_name            VARCHAR,
    p_description     VARCHAR DEFAULT NULL,
    p_color           VARCHAR DEFAULT NULL,
    p_icon            VARCHAR DEFAULT NULL,
    p_metadata        JSONB   DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    id              INTEGER,
    organization_id VARCHAR,
    key             VARCHAR,
    name            VARCHAR,
    description     VARCHAR,
    color           VARCHAR,
    icon            VARCHAR,
    metadata        JSONB,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_row organization.tags%ROWTYPE;
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);

    INSERT INTO organization.tags (
        organization_id, key, name, description, color, icon, metadata
    )
    VALUES (
        p_organization_id, p_key, p_name, p_description, p_color, p_icon,
        COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING * INTO v_row;

    RETURN QUERY SELECT
        v_row.id, v_row.organization_id, v_row.key, v_row.name,
        v_row.description, v_row.color, v_row.icon, v_row.metadata,
        v_row.created_at, v_row.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_tag_update(
    p_organization_id VARCHAR,
    p_id              INTEGER,
    p_name            VARCHAR DEFAULT NULL,
    p_description     VARCHAR DEFAULT NULL,
    p_clear_description BOOLEAN DEFAULT FALSE,
    p_color           VARCHAR DEFAULT NULL,
    p_clear_color     BOOLEAN DEFAULT FALSE,
    p_icon            VARCHAR DEFAULT NULL,
    p_clear_icon      BOOLEAN DEFAULT FALSE,
    p_metadata        JSONB   DEFAULT NULL
)
RETURNS TABLE (
    id              INTEGER,
    organization_id VARCHAR,
    key             VARCHAR,
    name            VARCHAR,
    description     VARCHAR,
    color           VARCHAR,
    icon            VARCHAR,
    metadata        JSONB,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    UPDATE organization.tags SET
        name        = COALESCE(p_name, tags.name),
        description = CASE
            WHEN p_clear_description THEN NULL
            WHEN p_description IS NOT NULL THEN p_description
            ELSE tags.description
        END,
        color       = CASE
            WHEN p_clear_color THEN NULL
            WHEN p_color IS NOT NULL THEN p_color
            ELSE tags.color
        END,
        icon        = CASE
            WHEN p_clear_icon THEN NULL
            WHEN p_icon IS NOT NULL THEN p_icon
            ELSE tags.icon
        END,
        metadata    = COALESCE(p_metadata, tags.metadata),
        updated_at  = NOW()
    WHERE tags.id = p_id AND tags.organization_id = p_organization_id
    RETURNING tags.id, tags.organization_id, tags.key, tags.name,
              tags.description, tags.color, tags.icon, tags.metadata,
              tags.created_at, tags.updated_at;
$$;

CREATE OR REPLACE FUNCTION organization.fn_tag_get(
    p_organization_id       VARCHAR,
    p_id                    INTEGER,
    p_include_summary       BOOLEAN   DEFAULT NULL,
    p_allowed_device_ids    VARCHAR[] DEFAULT NULL,
    p_allowed_group_ids     INTEGER[] DEFAULT NULL,
    p_allowed_location_ids  INTEGER[] DEFAULT NULL
)
RETURNS TABLE (
    id              INTEGER,
    organization_id VARCHAR,
    key             VARCHAR,
    name            VARCHAR,
    description     VARCHAR,
    color           VARCHAR,
    icon            VARCHAR,
    metadata        JSONB,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ,
    counts          JSONB
)
LANGUAGE sql
AS $$
    SELECT
        t.id, t.organization_id, t.key, t.name, t.description, t.color,
        t.icon, t.metadata, t.created_at, t.updated_at,
        CASE WHEN p_include_summary THEN
            COALESCE(
                (SELECT jsonb_object_agg(subject_type, c)
                 FROM (
                     SELECT ta.subject_type, COUNT(*) AS c
                     FROM organization.tag_assignments ta
                     WHERE ta.tag_id = t.id
                       AND ta.organization_id = p_organization_id
                       AND (
                           ta.subject_type NOT IN ('device','entity','group','location')
                           OR (ta.subject_type = 'device'
                               AND (p_allowed_device_ids IS NULL
                                    OR ta.subject_id = ANY(p_allowed_device_ids)))
                           OR (ta.subject_type = 'entity'
                               AND organization.fn_entity_belongs_to_device(ta.subject_id, p_allowed_device_ids))
                           OR (ta.subject_type = 'group'
                               AND (p_allowed_group_ids IS NULL
                                    OR ta.subject_id IN (
                                        SELECT id::text FROM unnest(p_allowed_group_ids) AS x(id)
                                    )))
                           OR (ta.subject_type = 'location'
                               AND (p_allowed_location_ids IS NULL
                                    OR ta.subject_id IN (
                                        SELECT id::text FROM unnest(p_allowed_location_ids) AS x(id)
                                    )))
                       )
                     GROUP BY ta.subject_type
                 ) agg),
                '{}'::jsonb
            )
        END
    FROM organization.tags t
    WHERE t.id = p_id AND t.organization_id = p_organization_id;
$$;

CREATE OR REPLACE FUNCTION organization.fn_tag_list(
    p_organization_id       VARCHAR,
    p_query                 VARCHAR   DEFAULT NULL,
    p_key                   VARCHAR   DEFAULT NULL,
    p_limit                 INTEGER   DEFAULT 200,
    p_offset                INTEGER   DEFAULT 0,
    p_sort_by               VARCHAR   DEFAULT 'key',
    p_sort_dir              VARCHAR   DEFAULT 'asc',
    p_include_summary       BOOLEAN   DEFAULT NULL,
    p_allowed_device_ids    VARCHAR[] DEFAULT NULL,
    p_allowed_group_ids     INTEGER[] DEFAULT NULL,
    p_allowed_location_ids  INTEGER[] DEFAULT NULL
)
RETURNS TABLE (
    total_count     BIGINT,
    id              INTEGER,
    organization_id VARCHAR,
    key             VARCHAR,
    name            VARCHAR,
    description     VARCHAR,
    color           VARCHAR,
    icon            VARCHAR,
    metadata        JSONB,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ,
    counts          JSONB
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT t.*
        FROM organization.tags t
        WHERE t.organization_id = p_organization_id
          AND (p_key IS NULL OR t.key = LOWER(p_key))
          AND (p_query IS NULL OR (
              t.name ILIKE '%' || p_query || '%'
              OR t.key  ILIKE '%' || p_query || '%'
          ))
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        f.id, f.organization_id, f.key, f.name, f.description, f.color,
        f.icon, f.metadata, f.created_at, f.updated_at,
        CASE WHEN p_include_summary THEN
            COALESCE(
                (SELECT jsonb_object_agg(subject_type, c)
                 FROM (
                     SELECT ta.subject_type, COUNT(*) AS c
                     FROM organization.tag_assignments ta
                     WHERE ta.tag_id = f.id
                       AND ta.organization_id = p_organization_id
                       AND (
                           ta.subject_type NOT IN ('device','entity','group','location')
                           OR (ta.subject_type = 'device'
                               AND (p_allowed_device_ids IS NULL
                                    OR ta.subject_id = ANY(p_allowed_device_ids)))
                           OR (ta.subject_type = 'entity'
                               AND organization.fn_entity_belongs_to_device(ta.subject_id, p_allowed_device_ids))
                           OR (ta.subject_type = 'group'
                               AND (p_allowed_group_ids IS NULL
                                    OR ta.subject_id IN (
                                        SELECT id::text FROM unnest(p_allowed_group_ids) AS x(id)
                                    )))
                           OR (ta.subject_type = 'location'
                               AND (p_allowed_location_ids IS NULL
                                    OR ta.subject_id IN (
                                        SELECT id::text FROM unnest(p_allowed_location_ids) AS x(id)
                                    )))
                       )
                     GROUP BY ta.subject_type
                 ) agg),
                '{}'::jsonb
            )
        END
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY
            CASE WHEN p_sort_by = 'name'       AND p_sort_dir = 'asc'  THEN name       END ASC,
            CASE WHEN p_sort_by = 'name'       AND p_sort_dir = 'desc' THEN name       END DESC,
            CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'asc'  THEN created_at END ASC,
            CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'desc' THEN created_at END DESC,
            CASE WHEN p_sort_by = 'updated_at' AND p_sort_dir = 'asc'  THEN updated_at END ASC NULLS LAST,
            CASE WHEN p_sort_by = 'updated_at' AND p_sort_dir = 'desc' THEN updated_at END DESC NULLS LAST,
            CASE WHEN (p_sort_by NOT IN ('name','created_at','updated_at') OR p_sort_by IS NULL)
                      AND p_sort_dir = 'desc' THEN key END DESC,
            key ASC
        LIMIT p_limit OFFSET p_offset
    ) f ON TRUE;
$$;

ALTER TABLE organization.tags DROP COLUMN IF EXISTS image_asset_id;

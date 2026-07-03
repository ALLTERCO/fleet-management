--------------UP
-- Re-create every scope-layer fn that raises a 22023 so each RAISE carries
-- a DETAIL tag matching a DomainErrorKind in rpc/errors.ts. The TS translator
-- reads err.detail instead of string-matching err.message — removes the
-- fragile substring patches in translateDbError.

-- ---- Location update (cycle / parent validation) --------------------------
CREATE OR REPLACE FUNCTION organization.fn_location_update(
    p_organization_id    VARCHAR,
    p_id                 INTEGER,
    p_name               VARCHAR DEFAULT NULL,
    p_kind               VARCHAR DEFAULT NULL,
    p_parent_location_id INTEGER DEFAULT NULL,
    p_clear_parent       BOOLEAN DEFAULT FALSE,
    p_sort_order         INTEGER DEFAULT NULL,
    p_timezone           VARCHAR DEFAULT NULL,
    p_clear_timezone     BOOLEAN DEFAULT FALSE,
    p_address            JSONB   DEFAULT NULL,
    p_location_code      VARCHAR DEFAULT NULL,
    p_clear_code         BOOLEAN DEFAULT FALSE,
    p_geo                JSONB   DEFAULT NULL,
    p_metadata           JSONB   DEFAULT NULL
)
RETURNS TABLE (
    id                  INTEGER,
    organization_id     VARCHAR,
    name                VARCHAR,
    kind                VARCHAR,
    parent_location_id  INTEGER,
    sort_order          INTEGER,
    timezone            VARCHAR,
    address             JSONB,
    location_code       VARCHAR,
    geo                 JSONB,
    metadata            JSONB,
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_new_parent INTEGER;
    v_cycle_found BOOLEAN;
BEGIN
    IF p_clear_parent THEN
        v_new_parent := NULL;
    ELSE
        v_new_parent := p_parent_location_id;
    END IF;

    IF v_new_parent IS NOT NULL THEN
        IF v_new_parent = p_id THEN
            RAISE EXCEPTION 'location cannot be its own parent'
                USING ERRCODE = '22023', DETAIL = 'LocationParentCycle';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM organization.locations
            WHERE id = v_new_parent AND organization_id = p_organization_id
        ) THEN
            RAISE EXCEPTION 'parent_location_id % not found in organization %',
                v_new_parent, p_organization_id
                USING ERRCODE = '22023', DETAIL = 'LocationParentNotFound';
        END IF;

        WITH RECURSIVE ancestors AS (
            SELECT l.id, l.parent_location_id, 1 AS depth
            FROM organization.locations l
            WHERE l.id = v_new_parent
              AND l.organization_id = p_organization_id
            UNION ALL
            SELECT l.id, l.parent_location_id, a.depth + 1
            FROM organization.locations l
            JOIN ancestors a ON l.id = a.parent_location_id
            WHERE l.organization_id = p_organization_id
              AND a.depth < 64
        )
        SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = p_id)
        INTO v_cycle_found;

        IF v_cycle_found THEN
            RAISE EXCEPTION 'parent change would create a cycle'
                USING ERRCODE = '22023', DETAIL = 'LocationParentCycle';
        END IF;
    END IF;

    RETURN QUERY
    UPDATE organization.locations SET
        name        = COALESCE(p_name, locations.name),
        kind        = COALESCE(p_kind, locations.kind),
        parent_location_id = CASE
            WHEN p_clear_parent THEN NULL
            WHEN p_parent_location_id IS NOT NULL THEN p_parent_location_id
            ELSE locations.parent_location_id
        END,
        sort_order  = COALESCE(p_sort_order, locations.sort_order),
        timezone    = CASE
            WHEN p_clear_timezone THEN NULL
            WHEN p_timezone IS NOT NULL THEN p_timezone
            ELSE locations.timezone
        END,
        address     = COALESCE(p_address, locations.address),
        location_code = CASE
            WHEN p_clear_code THEN NULL
            WHEN p_location_code IS NOT NULL THEN p_location_code
            ELSE locations.location_code
        END,
        geo         = COALESCE(p_geo, locations.geo),
        metadata    = COALESCE(p_metadata, locations.metadata),
        updated_at  = NOW()
    WHERE locations.id = p_id
      AND locations.organization_id = p_organization_id
    RETURNING locations.id, locations.organization_id, locations.name,
              locations.kind, locations.parent_location_id, locations.sort_order,
              locations.timezone, locations.address, locations.location_code,
              locations.geo, locations.metadata, locations.created_at,
              locations.updated_at;
END;
$$;

-- ---- Location assignment (cross-org location id) --------------------------
CREATE OR REPLACE FUNCTION organization.fn_location_set_assignment(
    p_organization_id VARCHAR,
    p_subject_type    VARCHAR,
    p_subject_id      VARCHAR,
    p_location_id     INTEGER
)
RETURNS TABLE (
    organization_id VARCHAR,
    subject_type    VARCHAR,
    subject_id      VARCHAR,
    location_id     INTEGER,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);

    IF NOT EXISTS (
        SELECT 1 FROM organization.locations
        WHERE id = p_location_id
          AND organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'location_id % not found in organization %',
            p_location_id, p_organization_id
            USING ERRCODE = '22023', DETAIL = 'CrossOrgReference';
    END IF;

    RETURN QUERY
    INSERT INTO organization.location_assignments AS la (
        organization_id, subject_type, subject_id, location_id
    )
    VALUES (p_organization_id, p_subject_type, p_subject_id, p_location_id)
    ON CONFLICT (organization_id, subject_type, subject_id)
    DO UPDATE SET location_id = EXCLUDED.location_id, updated_at = NOW()
    RETURNING la.organization_id, la.subject_type, la.subject_id,
              la.location_id, la.created_at, la.updated_at;
END;
$$;

-- ---- Group create (parent not found) --------------------------------------
CREATE OR REPLACE FUNCTION organization.fn_group_create(
    p_organization_id VARCHAR,
    p_name            VARCHAR,
    p_description     VARCHAR DEFAULT NULL,
    p_parent_group_id INTEGER DEFAULT NULL,
    p_group_type      VARCHAR DEFAULT 'standard',
    p_metadata        JSONB   DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    id                INTEGER,
    organization_id   VARCHAR,
    name              VARCHAR,
    description       VARCHAR,
    parent_group_id   INTEGER,
    group_type        VARCHAR,
    membership_mode   VARCHAR,
    metadata          JSONB,
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);

    IF p_parent_group_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM organization.groups
        WHERE id = p_parent_group_id
          AND organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'parent_group_id % not found in organization %',
            p_parent_group_id, p_organization_id
            USING ERRCODE = '22023', DETAIL = 'GroupParentNotFound';
    END IF;

    RETURN QUERY
    INSERT INTO organization.groups (
        organization_id, name, description, parent_group_id,
        group_type, metadata
    )
    VALUES (
        p_organization_id, p_name, p_description, p_parent_group_id,
        COALESCE(p_group_type, 'standard'),
        COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING groups.id, groups.organization_id, groups.name, groups.description,
              groups.parent_group_id, groups.group_type, groups.membership_mode,
              groups.metadata, groups.created_at, groups.updated_at;
END;
$$;

-- ---- Group update (cycle / parent validation) -----------------------------
CREATE OR REPLACE FUNCTION organization.fn_group_update(
    p_organization_id VARCHAR,
    p_id              INTEGER,
    p_name            VARCHAR DEFAULT NULL,
    p_description     VARCHAR DEFAULT NULL,
    p_clear_description BOOLEAN DEFAULT FALSE,
    p_parent_group_id INTEGER DEFAULT NULL,
    p_clear_parent    BOOLEAN DEFAULT FALSE,
    p_group_type      VARCHAR DEFAULT NULL,
    p_metadata        JSONB   DEFAULT NULL
)
RETURNS TABLE (
    id                INTEGER,
    organization_id   VARCHAR,
    name              VARCHAR,
    description       VARCHAR,
    parent_group_id   INTEGER,
    group_type        VARCHAR,
    membership_mode   VARCHAR,
    metadata          JSONB,
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_new_parent INTEGER;
    v_cycle_found BOOLEAN;
BEGIN
    IF p_clear_parent THEN
        v_new_parent := NULL;
    ELSE
        v_new_parent := p_parent_group_id;
    END IF;

    IF v_new_parent IS NOT NULL THEN
        IF v_new_parent = p_id THEN
            RAISE EXCEPTION 'group cannot be its own parent'
                USING ERRCODE = '22023', DETAIL = 'GroupParentCycle';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM organization.groups
            WHERE id = v_new_parent
              AND organization_id = p_organization_id
        ) THEN
            RAISE EXCEPTION 'parent_group_id % not found in organization %',
                v_new_parent, p_organization_id
                USING ERRCODE = '22023', DETAIL = 'GroupParentNotFound';
        END IF;

        WITH RECURSIVE ancestors AS (
            SELECT g.id, g.parent_group_id, 1 AS depth
            FROM organization.groups g
            WHERE g.id = v_new_parent
              AND g.organization_id = p_organization_id
            UNION ALL
            SELECT g.id, g.parent_group_id, a.depth + 1
            FROM organization.groups g
            JOIN ancestors a ON g.id = a.parent_group_id
            WHERE g.organization_id = p_organization_id
              AND a.depth < 64
        )
        SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = p_id)
        INTO v_cycle_found;

        IF v_cycle_found THEN
            RAISE EXCEPTION 'parent change would create a cycle'
                USING ERRCODE = '22023', DETAIL = 'GroupParentCycle';
        END IF;
    END IF;

    RETURN QUERY
    UPDATE organization.groups SET
        name        = COALESCE(p_name, groups.name),
        description = CASE
            WHEN p_clear_description THEN NULL
            WHEN p_description IS NOT NULL THEN p_description
            ELSE groups.description
        END,
        parent_group_id = CASE
            WHEN p_clear_parent THEN NULL
            WHEN p_parent_group_id IS NOT NULL THEN p_parent_group_id
            ELSE groups.parent_group_id
        END,
        group_type  = COALESCE(p_group_type, groups.group_type),
        metadata    = COALESCE(p_metadata, groups.metadata),
        updated_at  = NOW()
    WHERE groups.id = p_id AND groups.organization_id = p_organization_id
    RETURNING groups.id, groups.organization_id, groups.name, groups.description,
              groups.parent_group_id, groups.group_type, groups.membership_mode,
              groups.metadata, groups.created_at, groups.updated_at;
END;
$$;

-- ---- Group add/remove members (unknown group, length mismatch) -----------
CREATE OR REPLACE FUNCTION organization.fn_group_add_members_batch(
    p_organization_id VARCHAR,
    p_group_id        INTEGER,
    p_subject_types   VARCHAR[],
    p_subject_ids     VARCHAR[]
)
RETURNS TABLE (
    group_id     INTEGER,
    subject_type VARCHAR,
    subject_id   VARCHAR
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF array_length(p_subject_types, 1) IS DISTINCT FROM array_length(p_subject_ids, 1) THEN
        RAISE EXCEPTION 'subject_types/subject_ids length mismatch'
            USING ERRCODE = '22023', DETAIL = 'InvalidPatchField';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM organization.groups
        WHERE id = p_group_id AND organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'group_id % not found in organization %',
            p_group_id, p_organization_id
            USING ERRCODE = '22023', DETAIL = 'GroupNotFound';
    END IF;

    RETURN QUERY
    INSERT INTO organization.group_members AS gm (
        organization_id, group_id, subject_type, subject_id
    )
    SELECT p_organization_id, p_group_id, s.subject_type, s.subject_id
    FROM unnest(p_subject_types, p_subject_ids) AS s(subject_type, subject_id)
    ON CONFLICT (group_id, subject_type, subject_id) DO NOTHING
    RETURNING gm.group_id, gm.subject_type, gm.subject_id;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_group_remove_members_batch(
    p_organization_id VARCHAR,
    p_group_id        INTEGER,
    p_subject_types   VARCHAR[],
    p_subject_ids     VARCHAR[]
)
RETURNS TABLE (
    group_id     INTEGER,
    subject_type VARCHAR,
    subject_id   VARCHAR
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF array_length(p_subject_types, 1) IS DISTINCT FROM array_length(p_subject_ids, 1) THEN
        RAISE EXCEPTION 'subject_types/subject_ids length mismatch'
            USING ERRCODE = '22023', DETAIL = 'InvalidPatchField';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM organization.groups
        WHERE id = p_group_id AND organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'group_id % not found in organization %',
            p_group_id, p_organization_id
            USING ERRCODE = '22023', DETAIL = 'GroupNotFound';
    END IF;

    RETURN QUERY
    DELETE FROM organization.group_members gm
    USING unnest(p_subject_types, p_subject_ids) AS s(subject_type, subject_id)
    WHERE gm.group_id = p_group_id
      AND gm.organization_id = p_organization_id
      AND gm.subject_type = s.subject_type
      AND gm.subject_id = s.subject_id
    RETURNING gm.group_id, gm.subject_type, gm.subject_id;
END;
$$;

-- ---- Tag assign/unassign (unknown tag, length mismatch) -------------------
CREATE OR REPLACE FUNCTION organization.fn_tag_assign_batch(
    p_organization_id VARCHAR,
    p_tag_id          INTEGER,
    p_subject_types   VARCHAR[],
    p_subject_ids     VARCHAR[]
)
RETURNS TABLE (
    tag_id       INTEGER,
    subject_type VARCHAR,
    subject_id   VARCHAR
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF array_length(p_subject_types, 1) IS DISTINCT FROM array_length(p_subject_ids, 1) THEN
        RAISE EXCEPTION 'subject_types/subject_ids length mismatch'
            USING ERRCODE = '22023', DETAIL = 'InvalidPatchField';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM organization.tags
        WHERE id = p_tag_id AND organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'tag_id % not found in organization %',
            p_tag_id, p_organization_id
            USING ERRCODE = '22023', DETAIL = 'TagNotFound';
    END IF;

    RETURN QUERY
    INSERT INTO organization.tag_assignments AS ta (
        organization_id, tag_id, subject_type, subject_id
    )
    SELECT p_organization_id, p_tag_id, s.subject_type, s.subject_id
    FROM unnest(p_subject_types, p_subject_ids) AS s(subject_type, subject_id)
    ON CONFLICT (tag_id, subject_type, subject_id) DO NOTHING
    RETURNING ta.tag_id, ta.subject_type, ta.subject_id;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_tag_unassign_batch(
    p_organization_id VARCHAR,
    p_tag_id          INTEGER,
    p_subject_types   VARCHAR[],
    p_subject_ids     VARCHAR[]
)
RETURNS TABLE (
    tag_id       INTEGER,
    subject_type VARCHAR,
    subject_id   VARCHAR
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF array_length(p_subject_types, 1) IS DISTINCT FROM array_length(p_subject_ids, 1) THEN
        RAISE EXCEPTION 'subject_types/subject_ids length mismatch'
            USING ERRCODE = '22023', DETAIL = 'InvalidPatchField';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM organization.tags
        WHERE id = p_tag_id AND organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'tag_id % not found in organization %',
            p_tag_id, p_organization_id
            USING ERRCODE = '22023', DETAIL = 'TagNotFound';
    END IF;

    RETURN QUERY
    DELETE FROM organization.tag_assignments ta
    USING unnest(p_subject_types, p_subject_ids) AS s(subject_type, subject_id)
    WHERE ta.tag_id = p_tag_id
      AND ta.organization_id = p_organization_id
      AND ta.subject_type = s.subject_type
      AND ta.subject_id = s.subject_id
    RETURNING ta.tag_id, ta.subject_type, ta.subject_id;
END;
$$;
--------------DOWN
-- Earlier migrations (6020/6026/6035/6036/6040/6041/6046/6047) still define
-- these functions. Re-applying those migrations restores the prior bodies.

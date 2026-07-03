--------------UP
-- UserGroupComponent raw-SQL → fn_*. fn_user_group_exists is in 6136.

CREATE FUNCTION organization.fn_user_group_list(
    p_tenant_id VARCHAR
)
RETURNS TABLE (
    id              TEXT,
    tenant_id       TEXT,
    name            VARCHAR,
    description     TEXT,
    parent_group_id TEXT,
    created_at      TIMESTAMPTZ,
    member_count    INT
)
LANGUAGE sql
STABLE
AS $$
    SELECT g.id::text, g.tenant_id::text, g.name, g.description,
           g.parent_group_id::text, g.created_at,
           (SELECT count(*)::int FROM organization.user_group_memberships m
             WHERE m.group_id = g.id) AS member_count
      FROM organization.user_groups g
     WHERE g.tenant_id = p_tenant_id
     ORDER BY g.name;
$$;

CREATE FUNCTION organization.fn_user_group_get(
    p_id        UUID,
    p_tenant_id VARCHAR
)
RETURNS TABLE (
    id              TEXT,
    tenant_id       TEXT,
    name            VARCHAR,
    description     TEXT,
    parent_group_id TEXT,
    created_at      TIMESTAMPTZ,
    member_count    INT
)
LANGUAGE sql
STABLE
AS $$
    SELECT g.id::text, g.tenant_id::text, g.name, g.description,
           g.parent_group_id::text, g.created_at,
           (SELECT count(*)::int FROM organization.user_group_memberships m
             WHERE m.group_id = g.id) AS member_count
      FROM organization.user_groups g
     WHERE g.id = p_id AND g.tenant_id = p_tenant_id;
$$;

CREATE FUNCTION organization.fn_user_group_create(
    p_tenant_id       VARCHAR,
    p_name            VARCHAR,
    p_description     TEXT,
    p_parent_group_id UUID
)
RETURNS TABLE (
    id              TEXT,
    tenant_id       TEXT,
    name            VARCHAR,
    description     TEXT,
    parent_group_id TEXT,
    created_at      TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    INSERT INTO organization.user_groups
        (tenant_id, name, description, parent_group_id)
    VALUES (p_tenant_id, p_name, p_description, p_parent_group_id)
    RETURNING id::text, tenant_id::text, name, description,
              parent_group_id::text, created_at;
$$;

-- p_reparent flips parent_group_id assignment on/off so callers can
-- distinguish "leave parent alone" from "set parent to NULL".
CREATE FUNCTION organization.fn_user_group_update(
    p_id              UUID,
    p_tenant_id       VARCHAR,
    p_name            VARCHAR,
    p_description     TEXT,
    p_parent_group_id UUID,
    p_reparent        BOOLEAN
)
RETURNS TABLE (
    id              TEXT,
    tenant_id       TEXT,
    name            VARCHAR,
    description     TEXT,
    parent_group_id TEXT,
    created_at      TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    UPDATE organization.user_groups
       SET name            = COALESCE(p_name, name),
           description     = COALESCE(p_description, description),
           parent_group_id = CASE WHEN p_reparent
                                    THEN p_parent_group_id
                                    ELSE parent_group_id
                               END
     WHERE id = p_id AND tenant_id = p_tenant_id
    RETURNING id::text, tenant_id::text, name, description,
              parent_group_id::text, created_at;
$$;

-- Cycle detection: returns TRUE iff `p_new_parent_id` is a descendant of
-- `p_group_id` (which would create a loop on reparent). Bounded by
-- p_depth_max so a corrupted tree can't loop forever.
CREATE FUNCTION organization.fn_user_group_is_descendant(
    p_group_id      UUID,
    p_tenant_id     VARCHAR,
    p_new_parent_id UUID,
    p_depth_max     INT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE descendants(id, depth) AS (
        SELECT id, 0
          FROM organization.user_groups
         WHERE id = p_group_id AND tenant_id = p_tenant_id
        UNION
        SELECT g.id, d.depth + 1
          FROM organization.user_groups g
          JOIN descendants d ON g.parent_group_id = d.id
         WHERE g.tenant_id = p_tenant_id AND d.depth < p_depth_max
    )
    SELECT EXISTS (SELECT 1 FROM descendants WHERE id = p_new_parent_id);
$$;

CREATE FUNCTION organization.fn_user_group_delete_safe(
    p_id        UUID,
    p_tenant_id VARCHAR
)
RETURNS TABLE (ref_count INT, deleted_count INT)
LANGUAGE sql
AS $$
    WITH refs AS (
        SELECT count(*)::int AS n
          FROM organization.assignments
         WHERE subject_type = 'user_group'
           AND subject_id = p_id::text
           AND tenant_id = p_tenant_id
    ),
    deleted AS (
        DELETE FROM organization.user_groups
         WHERE id = p_id
           AND tenant_id = p_tenant_id
           AND (SELECT n FROM refs) = 0
        RETURNING id
    )
    SELECT (SELECT n FROM refs),
           (SELECT count(*)::int FROM deleted);
$$;

CREATE FUNCTION organization.fn_user_group_list_members(
    p_group_id UUID
)
RETURNS TABLE (
    user_id    TEXT,
    added_at   TIMESTAMPTZ,
    added_by   TEXT
)
LANGUAGE sql
STABLE
AS $$
    SELECT user_id::text, added_at, added_by::text
      FROM organization.user_group_memberships
     WHERE group_id = p_group_id
     ORDER BY added_at;
$$;

CREATE FUNCTION organization.fn_user_group_add_members(
    p_group_id UUID,
    p_user_ids TEXT[],
    p_added_by VARCHAR
)
RETURNS TABLE (user_id TEXT)
LANGUAGE sql
AS $$
    INSERT INTO organization.user_group_memberships
        (group_id, user_id, added_by)
    SELECT p_group_id, uid, p_added_by
      FROM unnest(p_user_ids) AS t(uid)
    ON CONFLICT (group_id, user_id) DO NOTHING
    RETURNING user_id::text;
$$;

CREATE FUNCTION organization.fn_user_group_remove_members(
    p_group_id UUID,
    p_user_ids TEXT[]
)
RETURNS TABLE (user_id TEXT)
LANGUAGE sql
AS $$
    DELETE FROM organization.user_group_memberships
     WHERE group_id = p_group_id
       AND user_id = ANY(p_user_ids)
    RETURNING user_id::text;
$$;

--------------DOWN
DROP FUNCTION organization.fn_user_group_remove_members;
DROP FUNCTION organization.fn_user_group_add_members;
DROP FUNCTION organization.fn_user_group_list_members;
DROP FUNCTION organization.fn_user_group_delete_safe;
DROP FUNCTION organization.fn_user_group_is_descendant;
DROP FUNCTION organization.fn_user_group_update;
DROP FUNCTION organization.fn_user_group_create;
DROP FUNCTION organization.fn_user_group_get;
DROP FUNCTION organization.fn_user_group_list;

--------------UP
-- Org-scope the admit-by-id path. WaitingRoom.AcceptPendingById fed
-- client-supplied device ids into an UPDATE with no org predicate, so an
-- admit-capable tenant could flip + claim another org's devices by id
-- enumeration. Admit only unowned (pending) rows or the caller's own; rows
-- owned by another org drop out of RETURNING and surface to the caller as
-- errors. fn_list_set_organization_batch gets the same existing-org guard so
-- the follow-up stamp cannot overwrite a foreign owner either.
DROP FUNCTION IF EXISTS device.fn_admit_batch_by_ids(INT[], SMALLINT);

CREATE FUNCTION device.fn_admit_batch_by_ids(
    p_ids             INT[],
    p_control_access  SMALLINT,
    p_organization_id VARCHAR
)
RETURNS TABLE (
    external_id    VARCHAR(50),
    id             INT,
    control_access SMALLINT,
    created        TIMESTAMPTZ,
    updated        TIMESTAMPTZ,
    jdoc           JSONB
)
AS
$$
BEGIN
    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
        RETURN;
    END IF;
    RETURN QUERY
    UPDATE device.list d
       SET control_access = p_control_access,
           updated        = NOW()::TIMESTAMPTZ
     WHERE d.id = ANY(p_ids)
       AND (d.organization_id = p_organization_id
            OR d.organization_id IS NULL)
    RETURNING d.external_id, d.id, d.control_access,
              d.created, d.updated, d.jdoc;
END;
$$
LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION device.fn_list_set_organization_batch(
    p_external_ids VARCHAR[],
    p_organization_id VARCHAR
)
RETURNS TABLE (external_id VARCHAR)
LANGUAGE sql
AS $$
    UPDATE device.list
    SET organization_id = p_organization_id,
        updated = NOW()
    WHERE external_id = ANY(p_external_ids)
      AND (organization_id = p_organization_id
           OR organization_id IS NULL)
    RETURNING external_id;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_admit_batch_by_ids(INT[], SMALLINT, VARCHAR);

CREATE FUNCTION device.fn_admit_batch_by_ids(
    p_ids            INT[],
    p_control_access SMALLINT
)
RETURNS TABLE (
    external_id    VARCHAR(50),
    id             INT,
    control_access SMALLINT,
    created        TIMESTAMPTZ,
    updated        TIMESTAMPTZ,
    jdoc           JSONB
)
AS
$$
BEGIN
    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
        RETURN;
    END IF;
    RETURN QUERY
    UPDATE device.list d
       SET control_access = p_control_access,
           updated        = NOW()::TIMESTAMPTZ
     WHERE d.id = ANY(p_ids)
    RETURNING d.external_id, d.id, d.control_access,
              d.created, d.updated, d.jdoc;
END;
$$
LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION device.fn_list_set_organization_batch(
    p_external_ids VARCHAR[],
    p_organization_id VARCHAR
)
RETURNS TABLE (external_id VARCHAR)
LANGUAGE sql
AS $$
    UPDATE device.list
    SET organization_id = p_organization_id,
        updated = NOW()
    WHERE external_id = ANY(p_external_ids)
    RETURNING external_id;
$$;

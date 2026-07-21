--------------UP
-- Device metadata follows the logical device row. Hardware identifiers are
-- accepted at API boundaries but are not durable references.
CREATE UNIQUE INDEX IF NOT EXISTS organization_device_list_org_id_id_unique
    ON device.list (organization_id, id);

CREATE OR REPLACE FUNCTION organization.fn_resolve_device_id(
    p_organization_id VARCHAR,
    p_external_id     VARCHAR
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
STRICT
AS $$
DECLARE
    v_device_id INTEGER;
BEGIN
    SELECT dl.id
      INTO v_device_id
      FROM device.list dl
     WHERE dl.organization_id = p_organization_id
       AND dl.external_id = p_external_id;

    IF v_device_id IS NULL THEN
        RAISE EXCEPTION 'device % not found in organization %',
            p_external_id, p_organization_id
            USING ERRCODE = '22023';
    END IF;

    RETURN v_device_id;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_normalize_entity_subject(
    p_organization_id VARCHAR,
    p_subject_id      VARCHAR
)
RETURNS TABLE (
    device_id           INTEGER,
    entity_suffix       VARCHAR,
    preserved_subject_id VARCHAR
)
LANGUAGE plpgsql
STABLE
STRICT
AS $$
DECLARE
    v_numeric_prefix TEXT;
    v_device_id      INTEGER;
    v_external_id    VARCHAR;
BEGIN
    v_numeric_prefix := substring(p_subject_id FROM '^([1-9][0-9]*)_');
    IF v_numeric_prefix IS NOT NULL
       AND length(p_subject_id) > length(v_numeric_prefix) + 1
       AND (
           length(v_numeric_prefix) < 10
           OR (
               length(v_numeric_prefix) = 10
               AND v_numeric_prefix <= '2147483647'
           )
       )
    THEN
        SELECT dl.id
          INTO v_device_id
          FROM device.list dl
         WHERE dl.organization_id = p_organization_id
           AND dl.id = v_numeric_prefix::INTEGER;
        IF v_device_id IS NOT NULL THEN
            RETURN QUERY SELECT
                v_device_id,
                substring(p_subject_id FROM length(v_numeric_prefix) + 2)::VARCHAR,
                NULL::VARCHAR;
            RETURN;
        END IF;
    END IF;

    SELECT dl.id, dl.external_id
      INTO v_device_id, v_external_id
     FROM device.list dl
     WHERE dl.organization_id = p_organization_id
       AND left(p_subject_id, length(dl.external_id) + 1)
           = dl.external_id || '_'
       AND length(p_subject_id) > length(dl.external_id) + 1
     ORDER BY length(dl.external_id) DESC
     LIMIT 1;

    IF v_device_id IS NOT NULL THEN
        RETURN QUERY SELECT
            v_device_id,
            substring(p_subject_id FROM length(v_external_id) + 2)::VARCHAR,
            NULL::VARCHAR;
        RETURN;
    END IF;

    RETURN QUERY SELECT NULL::INTEGER, NULL::VARCHAR, p_subject_id;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_normalize_subject_reference(
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
    IF p_subject_type = 'device' THEN
        RETURN QUERY SELECT
            organization.fn_resolve_device_id(
                p_organization_id, p_subject_id
            ),
            NULL::VARCHAR,
            NULL::VARCHAR;
        RETURN;
    END IF;

    IF p_subject_type = 'entity' THEN
        RETURN QUERY
        SELECT normalized.device_id,
               normalized.preserved_subject_id,
               normalized.entity_suffix
          FROM organization.fn_normalize_entity_subject(
              p_organization_id, p_subject_id
          ) normalized;
        RETURN;
    END IF;

    RETURN QUERY SELECT NULL::INTEGER, p_subject_id, NULL::VARCHAR;
END;
$$;

ALTER TABLE organization.group_members ADD COLUMN IF NOT EXISTS device_id INTEGER;
ALTER TABLE organization.tag_assignments ADD COLUMN IF NOT EXISTS device_id INTEGER;
ALTER TABLE organization.location_assignments ADD COLUMN IF NOT EXISTS device_id INTEGER;
ALTER TABLE organization.group_members ADD COLUMN IF NOT EXISTS entity_suffix VARCHAR(255);
ALTER TABLE organization.tag_assignments ADD COLUMN IF NOT EXISTS entity_suffix VARCHAR(255);
ALTER TABLE organization.location_assignments ADD COLUMN IF NOT EXISTS entity_suffix VARCHAR(255);

-- Legacy seeds could leave memberships after deleting their device row.
DELETE FROM organization.group_members gm
 WHERE gm.subject_type = 'device'
   AND NOT EXISTS (
       SELECT 1 FROM device.list dl
        WHERE dl.organization_id = gm.organization_id
          AND dl.external_id = gm.subject_id
   );
DELETE FROM organization.tag_assignments ta
 WHERE ta.subject_type = 'device'
   AND NOT EXISTS (
       SELECT 1 FROM device.list dl
        WHERE dl.organization_id = ta.organization_id
          AND dl.external_id = ta.subject_id
   );
DELETE FROM organization.location_assignments la
 WHERE la.subject_type = 'device'
   AND NOT EXISTS (
       SELECT 1 FROM device.list dl
        WHERE dl.organization_id = la.organization_id
          AND dl.external_id = la.subject_id
   );

ALTER TABLE organization.group_members
    DROP CONSTRAINT group_member_pk,
    ALTER COLUMN subject_id DROP NOT NULL;
ALTER TABLE organization.tag_assignments
    DROP CONSTRAINT tag_assignment_pk,
    ALTER COLUMN subject_id DROP NOT NULL;
ALTER TABLE organization.location_assignments
    DROP CONSTRAINT location_assignment_pk,
    ALTER COLUMN subject_id DROP NOT NULL;

UPDATE organization.group_members gm
   SET device_id = dl.id,
       subject_id = NULL
  FROM device.list dl
 WHERE gm.subject_type = 'device'
   AND dl.organization_id = gm.organization_id
   AND dl.external_id = gm.subject_id;

UPDATE organization.tag_assignments ta
   SET device_id = dl.id,
       subject_id = NULL
  FROM device.list dl
 WHERE ta.subject_type = 'device'
   AND dl.organization_id = ta.organization_id
   AND dl.external_id = ta.subject_id;

UPDATE organization.location_assignments la
   SET device_id = dl.id,
       subject_id = NULL
  FROM device.list dl
 WHERE la.subject_type = 'device'
   AND dl.organization_id = la.organization_id
   AND dl.external_id = la.subject_id;

WITH matched AS (
    SELECT gm.group_id,
           gm.subject_id AS old_subject_id,
           normalized.device_id,
           normalized.entity_suffix
      FROM organization.group_members gm
      CROSS JOIN LATERAL organization.fn_normalize_entity_subject(
          gm.organization_id, gm.subject_id
      ) normalized
     WHERE gm.subject_type = 'entity'
       AND normalized.device_id IS NOT NULL
)
UPDATE organization.group_members gm
   SET device_id = matched.device_id,
       entity_suffix = matched.entity_suffix,
       subject_id = NULL
  FROM matched
 WHERE gm.group_id = matched.group_id
   AND gm.subject_type = 'entity'
   AND gm.subject_id = matched.old_subject_id;

WITH matched AS (
    SELECT ta.tag_id,
           ta.subject_id AS old_subject_id,
           normalized.device_id,
           normalized.entity_suffix
      FROM organization.tag_assignments ta
      CROSS JOIN LATERAL organization.fn_normalize_entity_subject(
          ta.organization_id, ta.subject_id
      ) normalized
     WHERE ta.subject_type = 'entity'
       AND normalized.device_id IS NOT NULL
)
UPDATE organization.tag_assignments ta
   SET device_id = matched.device_id,
       entity_suffix = matched.entity_suffix,
       subject_id = NULL
  FROM matched
 WHERE ta.tag_id = matched.tag_id
   AND ta.subject_type = 'entity'
   AND ta.subject_id = matched.old_subject_id;

WITH matched AS (
    SELECT la.organization_id,
           la.subject_id AS old_subject_id,
           normalized.device_id,
           normalized.entity_suffix
      FROM organization.location_assignments la
      CROSS JOIN LATERAL organization.fn_normalize_entity_subject(
          la.organization_id, la.subject_id
      ) normalized
     WHERE la.subject_type = 'entity'
       AND normalized.device_id IS NOT NULL
)
UPDATE organization.location_assignments la
   SET device_id = matched.device_id,
       entity_suffix = matched.entity_suffix,
       subject_id = NULL
  FROM matched
 WHERE la.organization_id = matched.organization_id
   AND la.subject_type = 'entity'
   AND la.subject_id = matched.old_subject_id;

ALTER TABLE organization.group_members
    ADD CONSTRAINT group_member_pk
        UNIQUE NULLS NOT DISTINCT (
            group_id, subject_type, subject_id, device_id, entity_suffix
        ),
    ADD CONSTRAINT group_member_device_ref_valid CHECK (
        (subject_type = 'device' AND device_id IS NOT NULL
            AND subject_id IS NULL AND entity_suffix IS NULL)
        OR
        (subject_type = 'entity' AND device_id IS NOT NULL
            AND subject_id IS NULL AND entity_suffix IS NOT NULL
            AND entity_suffix <> '')
        OR
        (subject_type = 'entity' AND device_id IS NULL
            AND subject_id IS NOT NULL AND entity_suffix IS NULL)
        OR
        (subject_type NOT IN ('device', 'entity') AND device_id IS NULL
            AND subject_id IS NOT NULL AND entity_suffix IS NULL)
    ),
    ADD CONSTRAINT group_member_device_fk
        FOREIGN KEY (organization_id, device_id)
        REFERENCES device.list (organization_id, id) ON DELETE CASCADE;

ALTER TABLE organization.tag_assignments
    ADD CONSTRAINT tag_assignment_pk
        UNIQUE NULLS NOT DISTINCT (
            tag_id, subject_type, subject_id, device_id, entity_suffix
        ),
    ADD CONSTRAINT tag_assignment_device_ref_valid CHECK (
        (subject_type = 'device' AND device_id IS NOT NULL
            AND subject_id IS NULL AND entity_suffix IS NULL)
        OR
        (subject_type = 'entity' AND device_id IS NOT NULL
            AND subject_id IS NULL AND entity_suffix IS NOT NULL
            AND entity_suffix <> '')
        OR
        (subject_type = 'entity' AND device_id IS NULL
            AND subject_id IS NOT NULL AND entity_suffix IS NULL)
        OR
        (subject_type NOT IN ('device', 'entity') AND device_id IS NULL
            AND subject_id IS NOT NULL AND entity_suffix IS NULL)
    ),
    ADD CONSTRAINT tag_assignment_device_fk
        FOREIGN KEY (organization_id, device_id)
        REFERENCES device.list (organization_id, id) ON DELETE CASCADE;

ALTER TABLE organization.location_assignments
    ADD CONSTRAINT location_assignment_pk
        UNIQUE NULLS NOT DISTINCT (
            organization_id, subject_type, subject_id, device_id, entity_suffix
        ),
    ADD CONSTRAINT location_assignment_device_ref_valid CHECK (
        (subject_type = 'device' AND device_id IS NOT NULL
            AND subject_id IS NULL AND entity_suffix IS NULL)
        OR
        (subject_type = 'entity' AND device_id IS NOT NULL
            AND subject_id IS NULL AND entity_suffix IS NOT NULL
            AND entity_suffix <> '')
        OR
        (subject_type = 'entity' AND device_id IS NULL
            AND subject_id IS NOT NULL AND entity_suffix IS NULL)
        OR
        (subject_type NOT IN ('device', 'entity') AND device_id IS NULL
            AND subject_id IS NOT NULL AND entity_suffix IS NULL)
    ),
    ADD CONSTRAINT location_assignment_device_fk
        FOREIGN KEY (organization_id, device_id)
        REFERENCES device.list (organization_id, id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS group_members_by_device
    ON organization.group_members (organization_id, device_id)
    WHERE subject_type = 'device';
CREATE INDEX IF NOT EXISTS tag_assignments_by_device
    ON organization.tag_assignments (organization_id, device_id)
    WHERE subject_type = 'device';
CREATE INDEX IF NOT EXISTS location_assignments_by_device
    ON organization.location_assignments (organization_id, device_id)
    WHERE subject_type = 'device';
CREATE INDEX IF NOT EXISTS group_members_by_entity_device
    ON organization.group_members (organization_id, device_id, entity_suffix)
    WHERE subject_type = 'entity' AND device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tag_assignments_by_entity_device
    ON organization.tag_assignments (organization_id, device_id, entity_suffix)
    WHERE subject_type = 'entity' AND device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS location_assignments_by_entity_device
    ON organization.location_assignments (
        organization_id, device_id, entity_suffix
    )
    WHERE subject_type = 'entity' AND device_id IS NOT NULL;

--------------DOWN
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM organization.group_members gm
          JOIN device.list dl ON dl.id = gm.device_id
         WHERE gm.subject_type = 'device'
           AND dl.external_id IS NULL
    ) OR EXISTS (
        SELECT 1
          FROM organization.tag_assignments ta
          JOIN device.list dl ON dl.id = ta.device_id
         WHERE ta.subject_type = 'device'
           AND dl.external_id IS NULL
    ) OR EXISTS (
        SELECT 1
          FROM organization.location_assignments la
          JOIN device.list dl ON dl.id = la.device_id
         WHERE la.subject_type = 'device'
           AND dl.external_id IS NULL
    ) THEN
        RAISE EXCEPTION 'cannot restore external device references with null external_id';
    END IF;
END;
$$;

ALTER TABLE organization.group_members
    DROP CONSTRAINT group_member_device_ref_valid;
ALTER TABLE organization.tag_assignments
    DROP CONSTRAINT tag_assignment_device_ref_valid;
ALTER TABLE organization.location_assignments
    DROP CONSTRAINT location_assignment_device_ref_valid;

UPDATE organization.group_members gm
   SET subject_id = dl.external_id
  FROM device.list dl
 WHERE gm.subject_type = 'device'
   AND dl.id = gm.device_id;
UPDATE organization.tag_assignments ta
   SET subject_id = dl.external_id
  FROM device.list dl
 WHERE ta.subject_type = 'device'
   AND dl.id = ta.device_id;
UPDATE organization.location_assignments la
   SET subject_id = dl.external_id
  FROM device.list dl
 WHERE la.subject_type = 'device'
   AND dl.id = la.device_id;

UPDATE organization.group_members
   SET subject_id = device_id::TEXT || '_' || entity_suffix
 WHERE subject_type = 'entity'
   AND device_id IS NOT NULL;
UPDATE organization.tag_assignments
   SET subject_id = device_id::TEXT || '_' || entity_suffix
 WHERE subject_type = 'entity'
   AND device_id IS NOT NULL;
UPDATE organization.location_assignments
   SET subject_id = device_id::TEXT || '_' || entity_suffix
 WHERE subject_type = 'entity'
   AND device_id IS NOT NULL;

DROP INDEX IF EXISTS organization.location_assignments_by_entity_device;
DROP INDEX IF EXISTS organization.tag_assignments_by_entity_device;
DROP INDEX IF EXISTS organization.group_members_by_entity_device;
DROP INDEX IF EXISTS organization.location_assignments_by_device;
DROP INDEX IF EXISTS organization.tag_assignments_by_device;
DROP INDEX IF EXISTS organization.group_members_by_device;

ALTER TABLE organization.location_assignments
    DROP CONSTRAINT location_assignment_device_fk,
    DROP CONSTRAINT location_assignment_pk,
    ALTER COLUMN subject_id SET NOT NULL,
    ADD CONSTRAINT location_assignment_pk
        PRIMARY KEY (organization_id, subject_type, subject_id),
    DROP COLUMN entity_suffix,
    DROP COLUMN device_id;

ALTER TABLE organization.tag_assignments
    DROP CONSTRAINT tag_assignment_device_fk,
    DROP CONSTRAINT tag_assignment_pk,
    ALTER COLUMN subject_id SET NOT NULL,
    ADD CONSTRAINT tag_assignment_pk
        PRIMARY KEY (tag_id, subject_type, subject_id),
    DROP COLUMN entity_suffix,
    DROP COLUMN device_id;

ALTER TABLE organization.group_members
    DROP CONSTRAINT group_member_device_fk,
    DROP CONSTRAINT group_member_pk,
    ALTER COLUMN subject_id SET NOT NULL,
    ADD CONSTRAINT group_member_pk
        PRIMARY KEY (group_id, subject_type, subject_id),
    DROP COLUMN entity_suffix,
    DROP COLUMN device_id;

DROP FUNCTION IF EXISTS organization.fn_normalize_subject_reference(
    VARCHAR, VARCHAR, VARCHAR
);
DROP FUNCTION IF EXISTS organization.fn_normalize_entity_subject(VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS organization.fn_resolve_device_id(VARCHAR, VARCHAR);
DROP INDEX IF EXISTS device.organization_device_list_org_id_id_unique;

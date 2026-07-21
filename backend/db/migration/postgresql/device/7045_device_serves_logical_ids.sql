--------------UP
CREATE UNIQUE INDEX IF NOT EXISTS device_list_organization_id_id_unique
    ON device.list (organization_id, id);

ALTER TABLE device.device_serves
    ADD COLUMN IF NOT EXISTS source_device_ref INTEGER,
    ADD COLUMN IF NOT EXISTS target_device_ref INTEGER;

UPDATE device.device_serves s
   SET source_device_ref = d.id
  FROM device.list d
 WHERE s.source_device_ref IS NULL
   AND d.organization_id = s.organization_id
   AND d.external_id = s.source_device_id;

UPDATE device.device_serves s
   SET target_device_ref = d.id
  FROM device.list d
 WHERE s.target_kind = 'device'
   AND s.target_device_ref IS NULL
   AND d.organization_id = s.organization_id
   AND d.external_id = s.target_id;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM device.device_serves
         WHERE source_device_ref IS NULL
            OR (target_kind = 'device' AND target_device_ref IS NULL)
    ) THEN
        RAISE EXCEPTION 'device_serves contains unresolved device references';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'device_serves_source_device_ref_fk'
           AND conrelid = 'device.device_serves'::regclass
    ) THEN
        ALTER TABLE device.device_serves
            ADD CONSTRAINT device_serves_source_device_ref_fk
            FOREIGN KEY (organization_id, source_device_ref)
            REFERENCES device.list (organization_id, id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'device_serves_target_device_ref_fk'
           AND conrelid = 'device.device_serves'::regclass
    ) THEN
        ALTER TABLE device.device_serves
            ADD CONSTRAINT device_serves_target_device_ref_fk
            FOREIGN KEY (organization_id, target_device_ref)
            REFERENCES device.list (organization_id, id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'device_serves_logical_refs_check'
           AND conrelid = 'device.device_serves'::regclass
    ) THEN
        ALTER TABLE device.device_serves
            ADD CONSTRAINT device_serves_logical_refs_check CHECK (
                source_device_ref IS NOT NULL
                AND (target_kind <> 'device' OR target_device_ref IS NOT NULL)
            );
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS device_serves_logical_unique
    ON device.device_serves (
        organization_id,
        source_device_ref,
        target_kind,
        COALESCE(target_device_ref::TEXT, target_id),
        relation
    );

CREATE INDEX IF NOT EXISTS idx_device_serves_source_ref
    ON device.device_serves (organization_id, source_device_ref);

CREATE INDEX IF NOT EXISTS idx_device_serves_target_ref
    ON device.device_serves (organization_id, target_device_ref)
    WHERE target_kind = 'device';

CREATE OR REPLACE FUNCTION device.fn_reassign_serves_ownership(
    p_organization_id VARCHAR,
    p_retained_device_id INTEGER,
    p_temporary_device_id INTEGER
)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    IF p_retained_device_id = p_temporary_device_id THEN
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM device.list
         WHERE organization_id = p_organization_id
           AND id = p_retained_device_id
    ) THEN
        RAISE EXCEPTION 'retained device does not exist in organization'
            USING ERRCODE = '23503', DETAIL = 'device';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM device.list
         WHERE organization_id = p_organization_id
           AND id = p_temporary_device_id
    ) THEN
        RAISE EXCEPTION 'temporary device does not exist in organization'
            USING ERRCODE = '23503', DETAIL = 'device';
    END IF;

    -- Keep the oldest edge when reassignment makes two edges identical.
    DELETE FROM device.device_serves candidate
    USING device.device_serves keeper
     WHERE candidate.organization_id = p_organization_id
       AND keeper.organization_id = p_organization_id
       AND candidate.id > keeper.id
       AND (
           candidate.source_device_ref = p_temporary_device_id
           OR candidate.target_device_ref = p_temporary_device_id
           OR keeper.source_device_ref = p_temporary_device_id
           OR keeper.target_device_ref = p_temporary_device_id
       )
       AND CASE
               WHEN candidate.source_device_ref = p_temporary_device_id
                   THEN p_retained_device_id
               ELSE candidate.source_device_ref
           END = CASE
               WHEN keeper.source_device_ref = p_temporary_device_id
                   THEN p_retained_device_id
               ELSE keeper.source_device_ref
           END
       AND candidate.target_kind = keeper.target_kind
       AND candidate.relation = keeper.relation
       AND CASE
               WHEN candidate.target_kind = 'device' THEN
                   CASE
                       WHEN candidate.target_device_ref = p_temporary_device_id
                           THEN p_retained_device_id
                       ELSE candidate.target_device_ref
                   END::TEXT
               ELSE candidate.target_id
           END = CASE
               WHEN keeper.target_kind = 'device' THEN
                   CASE
                       WHEN keeper.target_device_ref = p_temporary_device_id
                           THEN p_retained_device_id
                       ELSE keeper.target_device_ref
                   END::TEXT
               ELSE keeper.target_id
           END;

    UPDATE device.device_serves
       SET source_device_ref = CASE
               WHEN source_device_ref = p_temporary_device_id
                   THEN p_retained_device_id
               ELSE source_device_ref
           END,
           target_device_ref = CASE
               WHEN target_device_ref = p_temporary_device_id
                   THEN p_retained_device_id
               ELSE target_device_ref
           END,
           updated_at = NOW()
     WHERE organization_id = p_organization_id
       AND (
           source_device_ref = p_temporary_device_id
           OR target_device_ref = p_temporary_device_id
       );
END;
$$;

CREATE OR REPLACE VIEW device.v_device_serves_api AS
SELECT s.id,
       s.organization_id,
       source.external_id AS source_device_id,
       s.target_kind,
       CASE
           WHEN s.target_kind = 'device' THEN target.external_id
           ELSE s.target_id
       END AS target_id,
       s.relation,
       s.weight,
       s.created_at,
       s.updated_at
  FROM device.device_serves s
  JOIN device.list source
    ON source.organization_id = s.organization_id
   AND source.id = s.source_device_ref
  LEFT JOIN device.list target
    ON target.organization_id = s.organization_id
   AND target.id = s.target_device_ref;

--------------DOWN
DROP VIEW IF EXISTS device.v_device_serves_api;
DROP FUNCTION IF EXISTS device.fn_reassign_serves_ownership(VARCHAR, INTEGER, INTEGER);
DROP INDEX IF EXISTS device.idx_device_serves_target_ref;
DROP INDEX IF EXISTS device.idx_device_serves_source_ref;
DROP INDEX IF EXISTS device.device_serves_logical_unique;
ALTER TABLE device.device_serves
    DROP CONSTRAINT IF EXISTS device_serves_logical_refs_check,
    DROP CONSTRAINT IF EXISTS device_serves_target_device_ref_fk,
    DROP CONSTRAINT IF EXISTS device_serves_source_device_ref_fk,
    DROP COLUMN IF EXISTS target_device_ref,
    DROP COLUMN IF EXISTS source_device_ref;
DROP INDEX IF EXISTS device.device_list_organization_id_id_unique;

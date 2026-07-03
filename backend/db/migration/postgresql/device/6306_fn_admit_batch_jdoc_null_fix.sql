--------------UP
-- Migration-runner tracks applied files by name. Migration 6303 was
-- edited in place after first commit (c28b6917 vs. 3a8eb647) to fold
-- JSON null jdoc → SQL NULL, so any DB that already ran the pre-fix
-- 6303 would never re-apply the edit. CREATE OR REPLACE here lets that
-- DB pick up the fix on next migration run; a clean DB just re-installs
-- the same definition.
CREATE OR REPLACE FUNCTION device.fn_admit_batch(
    p_admissions JSONB,
    p_control_access SMALLINT
)
RETURNS TABLE (
    external_id VARCHAR(50),
    id INT,
    control_access SMALLINT,
    created TIMESTAMPTZ,
    updated TIMESTAMPTZ,
    jdoc JSONB
)
AS
$$
BEGIN
    IF p_admissions IS NULL
        OR jsonb_typeof(p_admissions) <> 'array'
        OR jsonb_array_length(p_admissions) = 0
    THEN
        RETURN;
    END IF;

    LOCK TABLE device.list IN SHARE ROW EXCLUSIVE MODE;

    -- NULLIF folds JSON null into SQL NULL — `{"jdoc":null}` and a
    -- missing key both mean "don't touch"; COALESCE then keeps d.jdoc.
    UPDATE device.list d
    SET
        jdoc = COALESCE(e.jdoc, d.jdoc),
        updated = NOW()::TIMESTAMPTZ
    FROM (
        SELECT a->>'external_id' AS ext_id,
               NULLIF(a->'jdoc', 'null'::jsonb) AS jdoc
        FROM jsonb_array_elements(p_admissions) a
    ) e
    WHERE d.external_id = e.ext_id;

    INSERT INTO device.list (external_id, jdoc)
    SELECT e.ext_id, e.jdoc
    FROM (
        SELECT a->>'external_id' AS ext_id,
               NULLIF(a->'jdoc', 'null'::jsonb) AS jdoc
        FROM jsonb_array_elements(p_admissions) a
    ) e
    WHERE NOT EXISTS (
        SELECT 1 FROM device.list d2 WHERE d2.external_id = e.ext_id
    );

    -- Table aliases on both UPDATEs disambiguate the RETURNS TABLE
    -- output column `external_id` from device.list.external_id; without
    -- them plpgsql raises "column reference ... is ambiguous".
    UPDATE device.list d
    SET control_access = p_control_access
    WHERE d.external_id IN (
        SELECT a->>'external_id' FROM jsonb_array_elements(p_admissions) a
    );

    RETURN QUERY
    SELECT d.external_id, d.id, d.control_access, d.created, d.updated, d.jdoc
    FROM device.list d
    WHERE d.external_id IN (
        SELECT a->>'external_id' FROM jsonb_array_elements(p_admissions) a
    );
END;
$$
LANGUAGE plpgsql;
--------------DOWN
-- No-op: the function is owned by 6303. Down here would leave the
-- runtime without fn_admit_batch even though 6303 was applied.
SELECT 1;

--------------UP
-- Batch admit: upsert device rows, then flip control_access in one shot.
-- Replaces the per-device WaitingRoom approve/deny/quarantine loop that
-- ran 3 round-trips per device (store + fetch + allow|deny).
-- p_admissions is JSONB with shape: [{external_id, jdoc}, ...].
-- p_control_access: 2=denied, 3=allowed (1=pending is the table default).
-- Concurrent fn_admit_batch / fn_add / direct writes serialise via the
-- table lock — there is no UNIQUE index on external_id, so the lock IS
-- the contract; bypassing it (raw INSERT outside this function) can
-- duplicate rows.
CREATE FUNCTION device.fn_admit_batch(
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
    -- Guard NULL / non-array input: jsonb_array_elements would otherwise
    -- raise a fatal error and the caller would see no per-device signal.
    IF p_admissions IS NULL
        OR jsonb_typeof(p_admissions) <> 'array'
        OR jsonb_array_length(p_admissions) = 0
    THEN
        RETURN;
    END IF;

    LOCK TABLE device.list IN SHARE ROW EXCLUSIVE MODE;

    -- Update existing rows: only overwrite jdoc when caller supplied one.
    -- NULLIF folds JSON null into SQL NULL — `{"jdoc":null}` and missing
    -- key both mean "don't touch"; COALESCE then keeps d.jdoc.
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

    -- Insert rows that did not already exist. The lock above guarantees
    -- no concurrent inserter slips a row in between WHERE NOT EXISTS and
    -- the INSERT itself.
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

    -- Apply admission decision to every device named in p_admissions.
    UPDATE device.list
    SET control_access = p_control_access
    WHERE external_id IN (
        SELECT a->>'external_id' FROM jsonb_array_elements(p_admissions) a
    );

    -- Caller diffs `external_id IN admittedRows` vs the input list to
    -- compute its `error[]` array — rows missing from the result mean
    -- the device row never landed (only possible if the insert path
    -- silently lost a row, which the lock prevents).
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
DROP FUNCTION device.fn_admit_batch;

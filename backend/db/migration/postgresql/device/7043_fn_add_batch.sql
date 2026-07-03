--------------UP
CREATE OR REPLACE FUNCTION device.fn_add_batch(p_entries JSONB)
RETURNS BIGINT
LANGUAGE plpgsql
AS
$$
DECLARE
    v_count BIGINT;
BEGIN
    IF p_entries IS NULL
        OR jsonb_typeof(p_entries) <> 'array'
        OR jsonb_array_length(p_entries) = 0
    THEN
        RETURN 0;
    END IF;

    LOCK TABLE device.list IN SHARE ROW EXCLUSIVE MODE;

    WITH input AS (
        SELECT DISTINCT ON (external_id)
            external_id,
            jdoc
        FROM (
            SELECT
                NULLIF(e.entry->>'external_id', '')::VARCHAR(50) AS external_id,
                NULLIF(e.entry->'jdoc', 'null'::jsonb) AS jdoc,
                e.ordinality
            FROM jsonb_array_elements(p_entries) WITH ORDINALITY AS e(entry, ordinality)
        ) raw
        WHERE external_id IS NOT NULL
        ORDER BY external_id, ordinality DESC
    ),
    updated AS (
        UPDATE device.list d
        SET
            jdoc = COALESCE(i.jdoc, d.jdoc),
            updated = NOW()::TIMESTAMPTZ
        FROM input i
        WHERE d.external_id = i.external_id
        RETURNING d.external_id
    ),
    inserted AS (
        INSERT INTO device.list (external_id, jdoc)
        SELECT i.external_id, i.jdoc
        FROM input i
        WHERE NOT EXISTS (
            SELECT 1 FROM updated u WHERE u.external_id = i.external_id
        )
        -- external_id's unique index is partial (WHERE external_id IS NOT NULL),
        -- so the conflict target must repeat that predicate to match it.
        ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE
        SET
            jdoc = COALESCE(EXCLUDED.jdoc, device.list.jdoc),
            updated = NOW()::TIMESTAMPTZ
        RETURNING external_id
    )
    SELECT COUNT(*) INTO v_count
    FROM (
        SELECT external_id FROM updated
        UNION ALL
        SELECT external_id FROM inserted
    ) written;

    RETURN v_count;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS device.fn_add_batch(JSONB);

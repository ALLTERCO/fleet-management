--------------UP
-- Apply a preset to a device: bulk UPSERT every (component_key, tag,
-- domain, channel) row from fm.energy_preset_classification into
-- fm.energy_classification, with source='preset_apply' audit rows.
-- Returns the count applied so the caller can surface "N applied"
-- without re-querying.

CREATE OR REPLACE FUNCTION fm.fn_apply_energy_preset(
    p_device INT,
    p_preset_id BIGINT,
    p_who VARCHAR(200)
)
RETURNS INT
AS $$
DECLARE
    v_row RECORD;
    v_count INT := 0;
BEGIN
    FOR v_row IN
        SELECT component_key, tag, domain, channel
        FROM fm.energy_preset_classification
        WHERE preset_id = p_preset_id
    LOOP
        PERFORM fm.fn_upsert_energy_classification(
            p_device,
            v_row.component_key,
            v_row.tag,
            v_row.domain,
            v_row.channel,
            p_who,
            'preset_apply'
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$
LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_apply_energy_preset(INT, BIGINT, VARCHAR(200));

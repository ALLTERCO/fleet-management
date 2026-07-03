--------------UP
-- Atomically create a preset + insert its per-component classifications
-- as one transaction. Parallel arrays match fn_append_stats style.

CREATE OR REPLACE FUNCTION fm.fn_save_energy_preset(
    p_name VARCHAR(200),
    p_signature VARCHAR(200),
    p_created_by VARCHAR(200),
    p_component_key VARCHAR(100)[],
    p_tag VARCHAR(30)[],
    p_domain VARCHAR(16)[],
    p_channel SMALLINT[]
)
RETURNS BIGINT
AS $$
DECLARE
    v_preset_id BIGINT;
BEGIN
    INSERT INTO fm.energy_preset (name, signature, created_at, created_by)
    VALUES (p_name, p_signature, now(), p_created_by)
    RETURNING preset_id INTO v_preset_id;

    INSERT INTO fm.energy_preset_classification (
        preset_id, component_key, tag, domain, channel
    )
    SELECT v_preset_id, ck, tg, dm, ch
    FROM unnest(p_component_key, p_tag, p_domain, p_channel)
        AS u(ck, tg, dm, ch);

    RETURN v_preset_id;
END;
$$
LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_save_energy_preset(
    VARCHAR(200), VARCHAR(200), VARCHAR(200),
    VARCHAR(100)[], VARCHAR(30)[], VARCHAR(16)[], SMALLINT[]
);

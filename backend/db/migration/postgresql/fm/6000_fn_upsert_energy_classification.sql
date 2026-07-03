--------------UP
-- UPSERT a single operator override + write an audit row capturing the
-- before/after snapshot. p_source distinguishes hand-set rows
-- ('create'/'update') from bulk preset application ('preset_apply').

CREATE OR REPLACE FUNCTION fm.fn_upsert_energy_classification(
    p_device INT,
    p_component_key VARCHAR(100),
    p_tag VARCHAR(30),
    p_domain VARCHAR(16),
    p_channel SMALLINT,
    p_who VARCHAR(200),
    p_source VARCHAR(16) DEFAULT 'update'
)
RETURNS void
AS $$
DECLARE
    v_old_tag VARCHAR(30);
    v_old_domain VARCHAR(16);
    v_source VARCHAR(16);
BEGIN
    SELECT tag, domain INTO v_old_tag, v_old_domain
        FROM fm.energy_classification
        WHERE device = p_device AND component_key = p_component_key;

    INSERT INTO fm.energy_classification (
        device, component_key, tag, domain, channel,
        declared_at, declared_by
    )
    VALUES (p_device, p_component_key, p_tag, p_domain, p_channel,
        now(), p_who)
    ON CONFLICT (device, component_key) DO UPDATE SET
        tag = EXCLUDED.tag,
        domain = EXCLUDED.domain,
        channel = EXCLUDED.channel,
        declared_at = now(),
        declared_by = EXCLUDED.declared_by;

    v_source := CASE
        WHEN p_source = 'preset_apply' THEN 'preset_apply'
        WHEN v_old_tag IS NULL THEN 'create'
        ELSE 'update'
    END;

    INSERT INTO fm.energy_classification_audit (
        device, component_key, who,
        old_tag, old_domain, new_tag, new_domain, source
    )
    VALUES (p_device, p_component_key, p_who,
        v_old_tag, v_old_domain, p_tag, p_domain, v_source);
END;
$$
LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_upsert_energy_classification(
    INT, VARCHAR(100), VARCHAR(30), VARCHAR(16), SMALLINT, VARCHAR(200), VARCHAR(16)
);

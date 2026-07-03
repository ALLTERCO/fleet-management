--------------UP
-- Delete one operator override + write an audit row capturing the
-- pre-delete snapshot. Returns true if a row existed, false if no-op.

CREATE OR REPLACE FUNCTION fm.fn_delete_energy_classification(
    p_device INT,
    p_component_key VARCHAR(100),
    p_who VARCHAR(200)
)
RETURNS BOOLEAN
AS $$
DECLARE
    v_old_tag VARCHAR(30);
    v_old_domain VARCHAR(16);
BEGIN
    SELECT tag, domain INTO v_old_tag, v_old_domain
        FROM fm.energy_classification
        WHERE device = p_device AND component_key = p_component_key;

    IF v_old_tag IS NULL THEN
        RETURN false;
    END IF;

    DELETE FROM fm.energy_classification
        WHERE device = p_device AND component_key = p_component_key;

    INSERT INTO fm.energy_classification_audit (
        device, component_key, who,
        old_tag, old_domain, new_tag, new_domain, source
    )
    VALUES (p_device, p_component_key, p_who,
        v_old_tag, v_old_domain, NULL, NULL, 'delete');

    RETURN true;
END;
$$
LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_delete_energy_classification(
    INT, VARCHAR(100), VARCHAR(200)
);

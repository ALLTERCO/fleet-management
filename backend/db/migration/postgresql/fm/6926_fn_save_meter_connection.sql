--------------UP
-- Create (p_id NULL) or update one topology edge, upserting on the
-- UNIQUE(org, meter, from_node, to_node) key so re-saving the same edge
-- only changes its direction. Every write is org-scoped: an update that
-- matches no row in the caller's org raises, so one organization can
-- never edit another's connection. The same-org FK on meter_id is the
-- DB backstop against a cross-tenant meter reference.

CREATE OR REPLACE FUNCTION fm.fn_save_meter_connection(
    p_id BIGINT,
    p_org VARCHAR(120),
    p_meter_id BIGINT,
    p_from_node VARCHAR(48),
    p_to_node VARCHAR(48),
    p_positive_direction VARCHAR(16)
)
RETURNS BIGINT
AS $$
DECLARE
    v_id BIGINT;
BEGIN
    IF p_id IS NULL THEN
        INSERT INTO fm.meter_connection (
            organization_id, meter_id, from_node, to_node, positive_direction
        )
        VALUES (
            p_org, p_meter_id, p_from_node, p_to_node, p_positive_direction
        )
        ON CONFLICT (organization_id, meter_id, from_node, to_node)
        DO UPDATE SET positive_direction = EXCLUDED.positive_direction
        RETURNING id INTO v_id;
    ELSE
        UPDATE fm.meter_connection SET
            meter_id = p_meter_id,
            from_node = p_from_node,
            to_node = p_to_node,
            positive_direction = p_positive_direction
        WHERE id = p_id AND organization_id = p_org;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'meter_connection % not found for organization %', p_id, p_org;
        END IF;
        v_id := p_id;
    END IF;

    RETURN v_id;
END;
$$
LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_save_meter_connection(
    BIGINT, VARCHAR(120), BIGINT, VARCHAR(48), VARCHAR(48), VARCHAR(16)
);

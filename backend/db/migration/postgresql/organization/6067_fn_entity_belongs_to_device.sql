--------------UP
-- Position-based prefix check for entity subject_ids.
-- Entity ids are '<shelly_id>_<component>:<type>' per EntityComposer.ts.
-- Returns TRUE if p_device_shelly_ids is NULL (no scope), or if the entity's
-- device prefix matches any allowed shelly_id. No LIKE wildcards involved.
CREATE OR REPLACE FUNCTION organization.fn_entity_belongs_to_device(
    p_subject_id        VARCHAR,
    p_device_shelly_ids VARCHAR[]
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_device_shelly_ids IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_device_shelly_ids) d(sid)
        WHERE substring(p_subject_id FOR length(d.sid) + 1) = d.sid || '_'
    );
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_entity_belongs_to_device(VARCHAR, VARCHAR[]);

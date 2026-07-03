--------------UP
-- One row per preset with classifications aggregated into JSONB so the
-- caller doesn't N+1 the per-preset row fetch. Order is stable
-- (preset_id ASC) so the UI list doesn't shuffle on refresh.

CREATE OR REPLACE FUNCTION fm.fn_list_energy_presets()
RETURNS TABLE (
    preset_id        BIGINT,
    name             VARCHAR(200),
    signature        VARCHAR(200),
    created_at       TIMESTAMP WITH TIME ZONE,
    created_by       VARCHAR(200),
    classifications  JSONB
)
AS $$
    SELECT
        p.preset_id,
        p.name,
        p.signature,
        p.created_at,
        p.created_by,
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'componentKey', pc.component_key,
                        'tag', pc.tag,
                        'domain', pc.domain,
                        'channel', pc.channel
                    )
                    ORDER BY pc.component_key
                )
                FROM fm.energy_preset_classification pc
                WHERE pc.preset_id = p.preset_id
            ),
            '[]'::jsonb
        ) AS classifications
    FROM fm.energy_preset p
    ORDER BY p.preset_id;
$$
LANGUAGE sql;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_list_energy_presets();

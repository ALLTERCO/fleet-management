--------------UP
CREATE OR REPLACE FUNCTION organization.fn_resolve_device_id(
    p_organization_id VARCHAR,
    p_external_id VARCHAR
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
STRICT
AS $$
DECLARE
    v_device_id INTEGER;
    v_logical_id BIGINT;
BEGIN
    v_logical_id := CASE
        WHEN p_external_id ~ '^[1-9][0-9]{0,9}$'
            THEN p_external_id::BIGINT
        ELSE NULL
    END;

    SELECT candidate.device_id
      INTO v_device_id
      FROM (
          SELECT current.id AS device_id, 0 AS priority
           FROM device.list current
           WHERE current.organization_id = p_organization_id
             AND current.id = CASE
                 WHEN v_logical_id BETWEEN 1 AND 2147483647
                     THEN v_logical_id::INTEGER
                 ELSE NULL
             END
          UNION ALL
          SELECT current.id, 1
            FROM device.list current
           WHERE current.organization_id = p_organization_id
             AND current.external_id = p_external_id
          UNION ALL
          SELECT retired.device_id, 2
            FROM device.retired_external_identity retired
            JOIN device.list current
              ON current.organization_id = retired.organization_id
             AND current.id = retired.device_id
           WHERE retired.organization_id = p_organization_id
             AND retired.external_id = p_external_id
      ) candidate
     ORDER BY candidate.priority
     LIMIT 1;

    IF v_device_id IS NULL THEN
        RAISE EXCEPTION 'device % not found in organization %',
            p_external_id, p_organization_id
            USING ERRCODE = '22023';
    END IF;

    RETURN v_device_id;
END;
$$;

--------------DOWN
-- Forward-only logical identity resolver.

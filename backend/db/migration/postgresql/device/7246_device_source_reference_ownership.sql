--------------UP
CREATE OR REPLACE FUNCTION device.fn_reassign_device_source_references(
    p_organization_id VARCHAR,
    p_retained_device_id INT,
    p_temporary_device_id INT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM device.list
         WHERE id = p_retained_device_id
           AND organization_id = p_organization_id
    ) OR NOT EXISTS (
        SELECT 1 FROM device.list
         WHERE id = p_temporary_device_id
           AND organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'replacement devices must belong to organization %',
            p_organization_id;
    END IF;

    UPDATE device.virtual_device_binding
       SET source_device_list_id = p_retained_device_id
     WHERE organization_id = p_organization_id
       AND source_device_list_id = p_temporary_device_id;

    UPDATE device.virtual_device_sample_source
       SET source_device_list_id = p_retained_device_id
     WHERE organization_id = p_organization_id
       AND source_device_list_id = p_temporary_device_id;

    UPDATE device.blu_transport
       SET shelly_device_list_id = CASE
               WHEN shelly_device_list_id = p_temporary_device_id
               THEN p_retained_device_id
               ELSE shelly_device_list_id
           END,
           assistant_device_list_id = CASE
               WHEN assistant_device_list_id = p_temporary_device_id
               THEN p_retained_device_id
               ELSE assistant_device_list_id
           END
     WHERE organization_id = p_organization_id
       AND (
           shelly_device_list_id = p_temporary_device_id
           OR assistant_device_list_id = p_temporary_device_id
       );
END;
$$;

--------------DOWN
-- Forward-only logical identity migration.

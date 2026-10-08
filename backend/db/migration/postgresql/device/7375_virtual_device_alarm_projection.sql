--------------UP
SET search_path TO device;

UPDATE device.virtual_device_binding
   SET role_metadata_json = jsonb_set(
           jsonb_set(
               jsonb_set(
                   COALESCE(role_metadata_json, '{}'::jsonb),
                   '{projection,valuePath}',
                   to_jsonb('alarm'::text),
                   true
               ),
               '{projection,series}',
               to_jsonb('sensor_event'::text),
               true
           ),
           '{projection,field}',
           to_jsonb(split_part(source_component_key, ':', 1)),
           true
       )
 WHERE split_part(source_component_key, ':', 1) IN ('smoke', 'flood')
   AND COALESCE(role_metadata_json #>> '{projection,valuePath}', 'value') = 'value';

--------------DOWN
SET search_path TO device;

UPDATE device.virtual_device_binding
   SET role_metadata_json = jsonb_set(
           jsonb_set(
               jsonb_set(
                   COALESCE(role_metadata_json, '{}'::jsonb),
                   '{projection,valuePath}',
                   to_jsonb('value'::text),
                   true
               ),
               '{projection,series}',
               to_jsonb('status'::text),
               true
           ),
           '{projection,field}',
           to_jsonb('value'::text),
           true
       )
 WHERE split_part(source_component_key, ':', 1) IN ('smoke', 'flood')
   AND role_metadata_json #>> '{projection,valuePath}' = 'alarm'
   AND role_metadata_json #>> '{projection,series}' = 'sensor_event';

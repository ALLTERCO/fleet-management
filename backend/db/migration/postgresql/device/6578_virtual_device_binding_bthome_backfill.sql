--------------UP
-- Patch the previous backfill: bthomesensor / bthomecontrol legacy bindings
-- were collapsed to value_type='json' because the prefix table had no entry.

SET search_path TO device;

UPDATE device.virtual_device_binding
   SET value_type = 'number'
 WHERE value_type = 'json'
   AND split_part(source_component_key, ':', 1) = 'bthomesensor';

UPDATE device.virtual_device_binding
   SET value_type = 'event'
 WHERE value_type = 'json'
   AND split_part(source_component_key, ':', 1) = 'bthomecontrol';

--------------DOWN
-- No down — old value_type was 'json' which was incorrect.

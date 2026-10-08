--------------UP
-- A gateway gives each paired BLU device its own BTHome ids (first free id),
-- so the same sensor can carry different component keys on two gateways.
-- Routing needs the keys of each gateway transport, not one list per device.
CREATE TABLE IF NOT EXISTS device.blu_transport_component (
    transport_id   UUID NOT NULL REFERENCES device.blu_transport(id) ON DELETE CASCADE,
    component_key  VARCHAR(80) NOT NULL,
    position       INTEGER NOT NULL,
    component_json JSONB NOT NULL,
    CONSTRAINT blu_transport_component_pk PRIMARY KEY (transport_id, component_key),
    CONSTRAINT blu_transport_component_key_valid CHECK (
        component_key ~ '^[a-z][a-z0-9_]*:[0-9]+$'
    )
);

-- Backfill keeps only the device keys that the gateway's stored config maps to
-- the same BLE address; the gateway's next promotion pass rebuilds the list.
INSERT INTO device.blu_transport_component (
    transport_id,
    component_key,
    position,
    component_json
)
SELECT bt.id,
       component.value->>'componentKey',
       component.position,
       component.value
  FROM device.blu_transport bt
  JOIN device.blu_device bd
    ON bd.device_list_id = bt.blu_device_list_id
   AND bd.organization_id = bt.organization_id
  JOIN device.list gateway
    ON gateway.id = bt.shelly_device_list_id
   AND gateway.organization_id = bt.organization_id
 CROSS JOIN LATERAL jsonb_array_elements(
       COALESCE(bd.source_components_json, '[]'::jsonb)
   ) WITH ORDINALITY AS component(value, position)
 WHERE bt.mode = 'bthome_gateway'
   AND component.value->>'componentKey' ~ '^[a-z][a-z0-9_]*:[0-9]+$'
   AND lower(regexp_replace(
           gateway.jdoc->'settings'->(component.value->>'componentKey')->>'addr',
           '[^0-9A-Fa-f]', '', 'g'
       )) = bd.stable_id
ON CONFLICT DO NOTHING;

--------------DOWN
DROP TABLE IF EXISTS device.blu_transport_component;

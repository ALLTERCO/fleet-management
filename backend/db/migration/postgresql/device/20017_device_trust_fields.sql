--------------UP
-- Trust posture on the single device record. The gate stamps a device's
-- last-observed security model, transport, risk, and liveness here (write-behind,
-- keyed on external_id) so trust lives on device.list — the single source — not
-- the unused device_ingress_identity table. Columns are nullable: existing rows
-- carry no posture until the device next connects.
ALTER TABLE device.list
    ADD COLUMN IF NOT EXISTS security_model text,
    ADD COLUMN IF NOT EXISTS transport      text,
    ADD COLUMN IF NOT EXISTS risk_level     text,
    ADD COLUMN IF NOT EXISTS last_seen      timestamptz;

-- Same domains + trust invariants the ingress identity enforced: plain ws is
-- always legacy, and a certificate never rides plain ws. NULL columns pass
-- (partly-stamped rows are valid) — the gate only ever writes all three together.
ALTER TABLE device.list
    ADD CONSTRAINT device_list_security_model_chk CHECK (
        security_model IS NULL
        OR security_model IN ('certificate', 'direct_token', 'connector')
    ),
    ADD CONSTRAINT device_list_transport_chk CHECK (
        transport IS NULL
        OR transport IN (
            'wss', 'ws', 'modbus_tcp', 'ble', 'cloud_api', 'connector_internal'
        )
    ),
    ADD CONSTRAINT device_list_risk_level_chk CHECK (
        risk_level IS NULL
        OR risk_level IN ('strong', 'compatible', 'legacy')
    ),
    ADD CONSTRAINT device_list_ws_risk_chk CHECK (
        transport IS DISTINCT FROM 'ws' OR risk_level = 'legacy'
    ),
    ADD CONSTRAINT device_list_cert_transport_chk CHECK (
        security_model IS DISTINCT FROM 'certificate'
        OR transport IS DISTINCT FROM 'ws'
    );

-- Carry any existing ingress-identity posture onto its device row so the single
-- source starts populated (identity rows are rare in practice; this is a no-op
-- when there are none).
UPDATE device.list d
   SET security_model = i.security_model,
       transport      = i.transport,
       risk_level     = i.risk_level,
       last_seen      = i.last_seen_at
  FROM organization.device_ingress_identity i
 WHERE i.subject_type = 'device'
   AND i.status <> 'deleted'
   AND (
        d.external_id = i.expected_external_id
        OR d.external_id = ANY (i.reported_external_ids)
   );

--------------DOWN
ALTER TABLE device.list
    DROP CONSTRAINT IF EXISTS device_list_cert_transport_chk,
    DROP CONSTRAINT IF EXISTS device_list_ws_risk_chk,
    DROP CONSTRAINT IF EXISTS device_list_risk_level_chk,
    DROP CONSTRAINT IF EXISTS device_list_transport_chk,
    DROP CONSTRAINT IF EXISTS device_list_security_model_chk;

ALTER TABLE device.list
    DROP COLUMN IF EXISTS last_seen,
    DROP COLUMN IF EXISTS risk_level,
    DROP COLUMN IF EXISTS transport,
    DROP COLUMN IF EXISTS security_model;

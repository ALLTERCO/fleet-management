--------------UP
-- Capacity runs repeatedly join one BLU device to its primary transport and
-- reconcile a gateway transport by org/device/mode. The original schema only
-- indexed the transport UUID, one enabled primary, and the gateway id. That
-- left the common org+BLU-device lookups doing millions of sequential scans.
CREATE INDEX IF NOT EXISTS idx_blu_transport_device_org_primary_lookup
    ON device.blu_transport (
        blu_device_list_id,
        organization_id,
        enabled DESC,
        last_seen_at DESC NULLS LAST
    )
    WHERE is_primary IS TRUE;

CREATE INDEX IF NOT EXISTS idx_blu_transport_org_device_mode_shelly
    ON device.blu_transport (
        organization_id,
        blu_device_list_id,
        mode,
        shelly_device_list_id
    );

--------------DOWN
DROP INDEX IF EXISTS device.idx_blu_transport_org_device_mode_shelly;
DROP INDEX IF EXISTS device.idx_blu_transport_device_org_primary_lookup;

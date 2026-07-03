--------------UP
-- ON DELETE SET NULL FKs force a child scan on every parent delete. These
-- columns were unindexed → seq scan. Partial indexes (the columns are mostly
-- NULL) keep the FK maintenance cheap without bloating the table.

CREATE INDEX IF NOT EXISTS device_ingress_credential_certificate_idx
    ON organization.device_ingress_credential (certificate_id)
    WHERE certificate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS device_ingress_connection_credential_idx
    ON organization.device_ingress_connection (credential_id)
    WHERE credential_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS device_ingress_rejection_identity_idx
    ON organization.device_ingress_rejection (identity_id)
    WHERE identity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS device_ingress_rejection_credential_idx
    ON organization.device_ingress_rejection (credential_id)
    WHERE credential_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS device_ingress_rejection_waiting_room_idx
    ON organization.device_ingress_rejection (waiting_room_id)
    WHERE waiting_room_id IS NOT NULL;

--------------DOWN
DROP INDEX IF EXISTS organization.device_ingress_rejection_waiting_room_idx;
DROP INDEX IF EXISTS organization.device_ingress_rejection_credential_idx;
DROP INDEX IF EXISTS organization.device_ingress_rejection_identity_idx;
DROP INDEX IF EXISTS organization.device_ingress_connection_credential_idx;
DROP INDEX IF EXISTS organization.device_ingress_credential_certificate_idx;

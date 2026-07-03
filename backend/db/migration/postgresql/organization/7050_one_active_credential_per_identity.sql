--------------UP
-- Enforce the rotation invariant in the DB: at most one active credential per
-- (organization, identity, credential_type). First collapse any pre-existing
-- duplicate actives (keep the most recent) so the unique index can be built.
UPDATE organization.device_ingress_credential c
   SET state = 'superseded', updated_at = now()
 WHERE c.state = 'active'
   AND EXISTS (
       SELECT 1
         FROM organization.device_ingress_credential c2
        WHERE c2.organization_id = c.organization_id
          AND c2.identity_id = c.identity_id
          AND c2.credential_type = c.credential_type
          AND c2.state = 'active'
          AND (c2.updated_at, c2.id) > (c.updated_at, c.id)
   );

CREATE UNIQUE INDEX IF NOT EXISTS device_ingress_credential_one_active
    ON organization.device_ingress_credential
       (organization_id, identity_id, credential_type)
 WHERE state = 'active';

--------------DOWN
DROP INDEX IF EXISTS organization.device_ingress_credential_one_active;

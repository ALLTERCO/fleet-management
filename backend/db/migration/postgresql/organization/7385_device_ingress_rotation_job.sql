--------------UP
-- One row per device in a token rotation batch. The device restarts after
-- Ws.SetConfig, so the job waits for it to come back with either key.
CREATE TABLE IF NOT EXISTS organization.device_ingress_rotation_job (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    batch_id             uuid NOT NULL,
    identity_id          uuid NOT NULL
        REFERENCES organization.device_ingress_identity(id) ON DELETE CASCADE,
    old_credential_id    uuid NOT NULL
        REFERENCES organization.device_ingress_credential(id) ON DELETE CASCADE,
    new_credential_id    uuid
        REFERENCES organization.device_ingress_credential(id) ON DELETE SET NULL,
    state                text NOT NULL DEFAULT 'queued' CHECK (
        state IN ('queued', 'sent', 'waiting', 'finalized', 'failed', 'cancelled')
    ),
    error_code           text CHECK (
        error_code IS NULL OR error_code IN
        ('offline', 'not_applied', 'send_failed', 'cancelled_by_operator')
    ),
    claimed_at           timestamptz,
    sent_at              timestamptz,
    created_by           text NOT NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_ingress_rotation_job_org_batch_idx
    ON organization.device_ingress_rotation_job (organization_id, batch_id);
CREATE INDEX IF NOT EXISTS device_ingress_rotation_job_org_state_idx
    ON organization.device_ingress_rotation_job (organization_id, state);
CREATE INDEX IF NOT EXISTS device_ingress_rotation_job_new_credential_idx
    ON organization.device_ingress_rotation_job (new_credential_id)
    WHERE new_credential_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS device_ingress_rotation_job_old_credential_state_idx
    ON organization.device_ingress_rotation_job (old_credential_id, state);
-- One open job per identity at a time.
CREATE UNIQUE INDEX IF NOT EXISTS device_ingress_rotation_job_one_open_per_identity
    ON organization.device_ingress_rotation_job (identity_id)
    WHERE state IN ('queued', 'sent', 'waiting');

--------------DOWN
DROP TABLE IF EXISTS organization.device_ingress_rotation_job;

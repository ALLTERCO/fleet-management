--------------UP
-- Device-agnostic, org-scoped, time-boxed enrollment tokens. An operator mints
-- one; a device that connects with it before not_after lands in THIS org's
-- waiting room (never auto-trusted). Only the peppered hash is stored; the raw
-- token is returned once. max_uses supports single (1) or multi-use (batch).
CREATE TABLE IF NOT EXISTS organization.device_ingress_enrollment_token (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    token_hash           text NOT NULL,
    token_prefix         text NOT NULL,
    -- A suggested onboarding profile shown to the approver; never auto-applied.
    preferred_profile_id text,
    state                text NOT NULL DEFAULT 'active' CHECK (
        state IN ('active', 'consumed', 'revoked')
    ),
    max_uses             integer NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
    use_count            integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
    not_after            timestamptz NOT NULL,
    created_by           VARCHAR(120),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    last_used_at         timestamptz,
    revoked_at           timestamptz
);

-- Lookup/consume key on the hash only (never the prefix).
CREATE UNIQUE INDEX IF NOT EXISTS device_ingress_enrollment_token_hash_idx
    ON organization.device_ingress_enrollment_token (token_hash);

-- Org-scoped list of live tokens + cheap active-cap counting.
CREATE INDEX IF NOT EXISTS device_ingress_enrollment_token_org_state_idx
    ON organization.device_ingress_enrollment_token
       (organization_id, state, not_after);

ALTER TABLE organization.device_ingress_waiting_room
    ADD COLUMN IF NOT EXISTS enrollment_token_id uuid
        REFERENCES organization.device_ingress_enrollment_token(id)
        ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS device_ingress_waiting_room_enrollment_token_idx
    ON organization.device_ingress_waiting_room (enrollment_token_id)
    WHERE enrollment_token_id IS NOT NULL;

--------------DOWN
DROP INDEX IF EXISTS organization.device_ingress_waiting_room_enrollment_token_idx;
ALTER TABLE organization.device_ingress_waiting_room
    DROP COLUMN IF EXISTS enrollment_token_id;
DROP INDEX IF EXISTS organization.device_ingress_enrollment_token_org_state_idx;
DROP INDEX IF EXISTS organization.device_ingress_enrollment_token_hash_idx;
DROP TABLE IF EXISTS organization.device_ingress_enrollment_token;

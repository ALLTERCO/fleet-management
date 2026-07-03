--------------UP
-- Bump every tenant's authz_version when a system persona (tenant_id IS NULL)
-- changes — otherwise cache invalidation never fires fleet-wide.

CREATE OR REPLACE FUNCTION organization.bump_authz_version() RETURNS trigger AS $$
DECLARE
    target_tenant VARCHAR(120);
BEGIN
    IF TG_OP = 'DELETE' THEN
        target_tenant := OLD.tenant_id;
    ELSE
        target_tenant := NEW.tenant_id;
    END IF;
    IF target_tenant IS NOT NULL THEN
        UPDATE organization.profile
            SET authz_version = authz_version + 1
            WHERE id = target_tenant;
    ELSE
        -- System persona / global object — fan out to every tenant so the
        -- in-process L1 + Redis L2 caches re-fetch the latest definition.
        UPDATE organization.profile
            SET authz_version = authz_version + 1;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

--------------DOWN
-- Restore the original tenant-only bump.
CREATE OR REPLACE FUNCTION organization.bump_authz_version() RETURNS trigger AS $$
DECLARE
    target_tenant VARCHAR(120);
BEGIN
    IF TG_OP = 'DELETE' THEN
        target_tenant := OLD.tenant_id;
    ELSE
        target_tenant := NEW.tenant_id;
    END IF;
    IF target_tenant IS NOT NULL THEN
        UPDATE organization.profile
            SET authz_version = authz_version + 1
            WHERE id = target_tenant;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

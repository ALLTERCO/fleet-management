--------------UP
-- NULL tenant_id is reserved for system-managed personas.
-- Any other shape is data corruption — fail loudly so ops investigates.
SET search_path TO organization;

DO $$
DECLARE
    bad_count int;
BEGIN
    SELECT count(*) INTO bad_count FROM personas
        WHERE tenant_id IS NULL AND is_system_managed = false;
    IF bad_count > 0 THEN
        RAISE EXCEPTION
            'Refusing to add personas tenant CHECK: % null-tenant non-system rows exist. '
            'Inspect organization.personas WHERE tenant_id IS NULL AND is_system_managed = false '
            'and either delete them or set is_system_managed = true before re-running.',
            bad_count;
    END IF;
END $$;

ALTER TABLE personas
    ADD CONSTRAINT personas_null_tenant_iff_system_check
    CHECK (
        (tenant_id IS NULL AND is_system_managed = true)
        OR (tenant_id IS NOT NULL)
    );

--------------DOWN
SET search_path TO organization;

ALTER TABLE personas
    DROP CONSTRAINT IF EXISTS personas_null_tenant_iff_system_check;

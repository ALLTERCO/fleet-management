--------------UP
ALTER TABLE organization.user_group_memberships
    ALTER COLUMN user_id TYPE text USING user_id::text;

ALTER TABLE organization.assignments
    ALTER COLUMN subject_id TYPE text USING subject_id::text;

ALTER TABLE organization.authz_audit
    ALTER COLUMN target_id TYPE text USING target_id::text;

--------------DOWN
-- The text→uuid reversal will fail on any non-UUID values that landed after
-- 6113 went out (Zitadel user IDs are not necessarily UUIDs). Guard the cast
-- so the migration aborts early with a clear message instead of leaving the
-- columns half-altered.
DO $$
DECLARE
    v_bad bigint;
BEGIN
    SELECT count(*) INTO v_bad FROM organization.user_group_memberships
        WHERE user_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
    IF v_bad > 0 THEN
        RAISE EXCEPTION '6113 DOWN: % non-UUID user_id row(s) in organization.user_group_memberships — cannot revert to uuid (one-way door, restore via pg_dump)', v_bad;
    END IF;
    SELECT count(*) INTO v_bad FROM organization.assignments
        WHERE subject_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
    IF v_bad > 0 THEN
        RAISE EXCEPTION '6113 DOWN: % non-UUID subject_id row(s) in organization.assignments — cannot revert to uuid', v_bad;
    END IF;
    SELECT count(*) INTO v_bad FROM organization.authz_audit
        WHERE target_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
    IF v_bad > 0 THEN
        RAISE EXCEPTION '6113 DOWN: % non-UUID target_id row(s) in organization.authz_audit — cannot revert to uuid', v_bad;
    END IF;
END $$;

ALTER TABLE organization.user_group_memberships
    ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

ALTER TABLE organization.assignments
    ALTER COLUMN subject_id TYPE uuid USING subject_id::uuid;

ALTER TABLE organization.authz_audit
    ALTER COLUMN target_id TYPE uuid USING target_id::uuid;

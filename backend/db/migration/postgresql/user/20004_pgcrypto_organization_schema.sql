--------------UP
-- 20002 did `CREATE EXTENSION IF NOT EXISTS pgcrypto` without a SCHEMA
-- clause. On fresh installs PostgreSQL places the extension wherever the
-- session search_path resolves first (typically `public`). 20003 then
-- references `organization.crypt(...)` explicitly and fails with
-- "function organization.crypt(varchar, varchar) does not exist".
-- Move the extension into `organization` (or create it there if missing).

DO $$
BEGIN
    -- organization schema must already exist (created by
    -- organization/1000_schema.sql long before this).
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.schemata WHERE schema_name = 'organization'
    ) THEN
        RAISE EXCEPTION 'organization schema missing — cannot place pgcrypto';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_extension e
          JOIN pg_namespace n ON e.extnamespace = n.oid
         WHERE e.extname = 'pgcrypto' AND n.nspname <> 'organization'
    ) THEN
        ALTER EXTENSION pgcrypto SET SCHEMA organization;
    ELSIF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
        CREATE EXTENSION pgcrypto SCHEMA organization;
    END IF;
END $$;

--------------DOWN
-- No reverse: 20003 (and any later migration calling organization.crypt)
-- depends on the extension being in `organization`. Moving it back would
-- break those callers. Down is a no-op.
SELECT 1;

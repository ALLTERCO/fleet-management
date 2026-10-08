--------------UP
-- Extension objects must be visible to normal monitoring connections.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_extension e
        JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname = 'pg_stat_statements'
          AND n.nspname <> 'public'
    ) THEN
        EXECUTE 'ALTER EXTENSION pg_stat_statements SET SCHEMA public';
    END IF;
END $$;

--------------DOWN
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_extension e
        JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname = 'pg_stat_statements'
          AND n.nspname = 'public'
    ) THEN
        EXECUTE 'ALTER EXTENSION pg_stat_statements SET SCHEMA logging';
    END IF;
END $$;

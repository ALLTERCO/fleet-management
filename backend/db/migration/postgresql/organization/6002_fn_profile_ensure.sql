--------------UP
-- Idempotent insert — lazy-create on first read.
CREATE OR REPLACE FUNCTION organization.fn_profile_ensure(
    p_id VARCHAR
)
RETURNS VOID
LANGUAGE sql
AS $$
    INSERT INTO organization.profile (id)
    VALUES (p_id)
    ON CONFLICT (id) DO NOTHING;
$$;
--------------DOWN
DROP FUNCTION organization.fn_profile_ensure;

--------------UP
-- Name an org from its deploy env (FM_CLIENT_ORG_NAME / FM_PLATFORM_ORG_NAME).
-- Only an unset (NULL) display_name is filled — an operator-set name is left
-- untouched, and an already-named org is a no-op (no rewrite, no churn).
CREATE OR REPLACE FUNCTION organization.fn_profile_set_default_name(
    p_id VARCHAR,
    p_display_name VARCHAR
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO organization.profile (id, display_name)
    VALUES (p_id, p_display_name)
    ON CONFLICT (id) DO UPDATE
        SET display_name = EXCLUDED.display_name,
            updated_at = NOW()
        WHERE organization.profile.display_name IS NULL;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_profile_set_default_name(VARCHAR, VARCHAR);

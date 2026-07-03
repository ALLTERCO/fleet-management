--------------UP
-- Per-org currency + unit system, first-class columns alongside locale_default
-- (not buried in metadata). Drive report formatting via buildFormatterContext.
ALTER TABLE organization.profile
    ADD COLUMN IF NOT EXISTS currency_default    VARCHAR(3),
    ADD COLUMN IF NOT EXISTS unit_system_default VARCHAR(8);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'profile_unit_system_chk'
    ) THEN
        ALTER TABLE organization.profile
            ADD CONSTRAINT profile_unit_system_chk
            CHECK (unit_system_default IN ('metric', 'imperial'));
    END IF;
    -- Mirror the API pattern (^[A-Z]{3}$) at the column so a stored code is
    -- always a well-formed ISO 4217 shape; Intl.NumberFormat then never throws.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'profile_currency_chk'
    ) THEN
        ALTER TABLE organization.profile
            ADD CONSTRAINT profile_currency_chk
            CHECK (currency_default ~ '^[A-Z]{3}$');
    END IF;
END $$;

-- Return type gains two columns, so the getter must be dropped + recreated
-- (CREATE OR REPLACE cannot change a function's RETURNS TABLE shape). Drop both
-- the pre- and post-currency update signatures so a re-run is idempotent.
DROP FUNCTION IF EXISTS organization.fn_profile_get(VARCHAR);
DROP FUNCTION IF EXISTS organization.fn_profile_update(
    VARCHAR, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN, JSONB
);
DROP FUNCTION IF EXISTS organization.fn_profile_update(
    VARCHAR, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN,
    VARCHAR, BOOLEAN, VARCHAR, BOOLEAN, JSONB
);
CREATE FUNCTION organization.fn_profile_get(
    p_id VARCHAR
)
RETURNS TABLE (
    id                  VARCHAR,
    name                VARCHAR,
    display_name        VARCHAR,
    timezone_default    VARCHAR,
    locale_default      VARCHAR,
    currency_default    VARCHAR,
    unit_system_default VARCHAR,
    metadata            JSONB,
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT id, name, display_name, timezone_default, locale_default,
           currency_default, unit_system_default,
           metadata, created_at, updated_at
    FROM organization.profile
    WHERE id = p_id;
$$;

CREATE FUNCTION organization.fn_profile_update(
    p_id                     VARCHAR,
    p_display_name           VARCHAR DEFAULT NULL,
    p_clear_display_name     BOOLEAN DEFAULT FALSE,
    p_timezone_default       VARCHAR DEFAULT NULL,
    p_clear_timezone         BOOLEAN DEFAULT FALSE,
    p_locale_default         VARCHAR DEFAULT NULL,
    p_clear_locale           BOOLEAN DEFAULT FALSE,
    p_currency_default       VARCHAR DEFAULT NULL,
    p_clear_currency         BOOLEAN DEFAULT FALSE,
    p_unit_system_default    VARCHAR DEFAULT NULL,
    p_clear_unit_system      BOOLEAN DEFAULT FALSE,
    p_metadata               JSONB   DEFAULT NULL
)
RETURNS TABLE (
    id                  VARCHAR,
    name                VARCHAR,
    display_name        VARCHAR,
    timezone_default    VARCHAR,
    locale_default      VARCHAR,
    currency_default    VARCHAR,
    unit_system_default VARCHAR,
    metadata            JSONB,
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM organization.fn_profile_ensure(p_id);
    RETURN QUERY
    UPDATE organization.profile SET
        display_name = CASE
            WHEN p_clear_display_name THEN NULL
            WHEN p_display_name IS NOT NULL THEN p_display_name
            ELSE profile.display_name
        END,
        timezone_default = CASE
            WHEN p_clear_timezone THEN NULL
            WHEN p_timezone_default IS NOT NULL THEN p_timezone_default
            ELSE profile.timezone_default
        END,
        locale_default = CASE
            WHEN p_clear_locale THEN NULL
            WHEN p_locale_default IS NOT NULL THEN p_locale_default
            ELSE profile.locale_default
        END,
        currency_default = CASE
            WHEN p_clear_currency THEN NULL
            WHEN p_currency_default IS NOT NULL THEN p_currency_default
            ELSE profile.currency_default
        END,
        unit_system_default = CASE
            WHEN p_clear_unit_system THEN NULL
            WHEN p_unit_system_default IS NOT NULL THEN p_unit_system_default
            ELSE profile.unit_system_default
        END,
        metadata = COALESCE(p_metadata, profile.metadata),
        updated_at = NOW()
    WHERE profile.id = p_id
    RETURNING profile.id, profile.name, profile.display_name,
              profile.timezone_default, profile.locale_default,
              profile.currency_default, profile.unit_system_default,
              profile.metadata, profile.created_at, profile.updated_at;
END;
$$;

--------------DOWN
-- Drop both update signatures so the rollback is idempotent regardless of
-- which one is currently installed.
DROP FUNCTION IF EXISTS organization.fn_profile_update(
    VARCHAR, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN,
    VARCHAR, BOOLEAN, VARCHAR, BOOLEAN, JSONB
);
DROP FUNCTION IF EXISTS organization.fn_profile_update(
    VARCHAR, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN, JSONB
);
DROP FUNCTION IF EXISTS organization.fn_profile_get(VARCHAR);
ALTER TABLE organization.profile DROP CONSTRAINT IF EXISTS profile_unit_system_chk;
ALTER TABLE organization.profile DROP CONSTRAINT IF EXISTS profile_currency_chk;
ALTER TABLE organization.profile
    DROP COLUMN IF EXISTS unit_system_default,
    DROP COLUMN IF EXISTS currency_default;

-- Restore the pre-currency getter/updater so a rollback leaves them callable.
CREATE FUNCTION organization.fn_profile_get(
    p_id VARCHAR
)
RETURNS TABLE (
    id                VARCHAR,
    name              VARCHAR,
    display_name      VARCHAR,
    timezone_default  VARCHAR,
    locale_default    VARCHAR,
    metadata          JSONB,
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT id, name, display_name, timezone_default, locale_default,
           metadata, created_at, updated_at
    FROM organization.profile
    WHERE id = p_id;
$$;

CREATE FUNCTION organization.fn_profile_update(
    p_id                    VARCHAR,
    p_display_name          VARCHAR DEFAULT NULL,
    p_clear_display_name    BOOLEAN DEFAULT FALSE,
    p_timezone_default      VARCHAR DEFAULT NULL,
    p_clear_timezone        BOOLEAN DEFAULT FALSE,
    p_locale_default        VARCHAR DEFAULT NULL,
    p_clear_locale          BOOLEAN DEFAULT FALSE,
    p_metadata              JSONB   DEFAULT NULL
)
RETURNS TABLE (
    id                VARCHAR,
    name              VARCHAR,
    display_name      VARCHAR,
    timezone_default  VARCHAR,
    locale_default    VARCHAR,
    metadata          JSONB,
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM organization.fn_profile_ensure(p_id);
    RETURN QUERY
    UPDATE organization.profile SET
        display_name = CASE
            WHEN p_clear_display_name THEN NULL
            WHEN p_display_name IS NOT NULL THEN p_display_name
            ELSE profile.display_name
        END,
        timezone_default = CASE
            WHEN p_clear_timezone THEN NULL
            WHEN p_timezone_default IS NOT NULL THEN p_timezone_default
            ELSE profile.timezone_default
        END,
        locale_default = CASE
            WHEN p_clear_locale THEN NULL
            WHEN p_locale_default IS NOT NULL THEN p_locale_default
            ELSE profile.locale_default
        END,
        metadata = COALESCE(p_metadata, profile.metadata),
        updated_at = NOW()
    WHERE profile.id = p_id
    RETURNING profile.id, profile.name, profile.display_name,
              profile.timezone_default, profile.locale_default,
              profile.metadata, profile.created_at, profile.updated_at;
END;
$$;

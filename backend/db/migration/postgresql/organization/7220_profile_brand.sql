--------------UP
-- Org brand mark for the sidebar: 1-3 initials + a palette token or hex color,
-- first-class columns alongside the other profile defaults (6870 pattern).
ALTER TABLE organization.profile
    ADD COLUMN IF NOT EXISTS brand_initials VARCHAR(3),
    ADD COLUMN IF NOT EXISTS brand_color    VARCHAR(64);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'profile_brand_initials_chk'
    ) THEN
        ALTER TABLE organization.profile
            ADD CONSTRAINT profile_brand_initials_chk
            CHECK (brand_initials ~ '^[A-Za-z0-9]{1,3}$');
    END IF;
    -- Mirrors the tag color rule (7130): palette token key or #RRGGBB hex.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'profile_brand_color_chk'
    ) THEN
        ALTER TABLE organization.profile
            ADD CONSTRAINT profile_brand_color_chk
            CHECK (brand_color ~ '^(#[0-9a-fA-F]{6}|[a-z][a-z0-9_-]{0,63})$');
    END IF;
END $$;

-- Return type gains two columns, so getter + updater must be dropped and
-- recreated (CREATE OR REPLACE cannot change a RETURNS TABLE shape). Drop
-- both the pre- and post-brand signatures so a re-run is idempotent.
DROP FUNCTION IF EXISTS organization.fn_profile_get(VARCHAR);
DROP FUNCTION IF EXISTS organization.fn_profile_update(
    VARCHAR, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN,
    VARCHAR, BOOLEAN, VARCHAR, BOOLEAN, JSONB
);
DROP FUNCTION IF EXISTS organization.fn_profile_update(
    VARCHAR, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN,
    VARCHAR, BOOLEAN, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN,
    JSONB
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
    brand_initials      VARCHAR,
    brand_color         VARCHAR,
    metadata            JSONB,
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT id, name, display_name, timezone_default, locale_default,
           currency_default, unit_system_default,
           brand_initials, brand_color,
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
    p_brand_initials         VARCHAR DEFAULT NULL,
    p_clear_brand_initials   BOOLEAN DEFAULT FALSE,
    p_brand_color            VARCHAR DEFAULT NULL,
    p_clear_brand_color      BOOLEAN DEFAULT FALSE,
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
    brand_initials      VARCHAR,
    brand_color         VARCHAR,
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
        brand_initials = CASE
            WHEN p_clear_brand_initials THEN NULL
            WHEN p_brand_initials IS NOT NULL THEN p_brand_initials
            ELSE profile.brand_initials
        END,
        brand_color = CASE
            WHEN p_clear_brand_color THEN NULL
            WHEN p_brand_color IS NOT NULL THEN p_brand_color
            ELSE profile.brand_color
        END,
        metadata = COALESCE(p_metadata, profile.metadata),
        updated_at = NOW()
    WHERE profile.id = p_id
    RETURNING profile.id, profile.name, profile.display_name,
              profile.timezone_default, profile.locale_default,
              profile.currency_default, profile.unit_system_default,
              profile.brand_initials, profile.brand_color,
              profile.metadata, profile.created_at, profile.updated_at;
END;
$$;

--------------DOWN
-- Drop both update signatures so the rollback is idempotent regardless of
-- which one is currently installed.
DROP FUNCTION IF EXISTS organization.fn_profile_update(
    VARCHAR, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN,
    VARCHAR, BOOLEAN, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN,
    JSONB
);
DROP FUNCTION IF EXISTS organization.fn_profile_update(
    VARCHAR, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN,
    VARCHAR, BOOLEAN, VARCHAR, BOOLEAN, JSONB
);
DROP FUNCTION IF EXISTS organization.fn_profile_get(VARCHAR);
ALTER TABLE organization.profile DROP CONSTRAINT IF EXISTS profile_brand_initials_chk;
ALTER TABLE organization.profile DROP CONSTRAINT IF EXISTS profile_brand_color_chk;
ALTER TABLE organization.profile
    DROP COLUMN IF EXISTS brand_initials,
    DROP COLUMN IF EXISTS brand_color;

-- Restore the pre-brand (6870) getter/updater so a rollback leaves them callable.
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

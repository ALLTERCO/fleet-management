--------------UP
-- organization.profile.metadata is one bag shared by unrelated writers: the
-- MCP kill-switch (modules/ai/mcpTenantPolicy.ts) plus one settings key per BM
-- template. It used to be REPLACED wholesale, so every caller had to read the
-- whole bag, splice its own key in and write it all back -- and any two writers
-- overlapping lost one of them. A dropped mcpPolicy key reads as "enabled", so
-- that loss silently re-enabled MCP for an org that had turned it off.
--
-- Now the parameter is a per-key patch, the shape 6111 settled on for
-- locations: key present with a value sets it, key present with null erases
-- it, key absent is left alone. A null parameter still means "no change".
--
-- Built inline in the UPDATE rather than read into a variable first: under
-- READ COMMITTED the second writer re-reads the locked row before evaluating
-- SET, so the merge is atomic. Reading into a variable would reintroduce the
-- gap this migration exists to close.
--
-- Callers sending the whole bag stay correct -- merging a superset is the same
-- write -- so this ships safely ahead of any caller change. Do not "tidy up"
-- the read-then-write in the templates until this has rolled out everywhere.
--
-- Body-only change: parameters and RETURNS TABLE are byte-identical to 7220,
-- so CREATE OR REPLACE is enough and no DROP is required.
CREATE OR REPLACE FUNCTION organization.fn_profile_update(
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
        -- Merge the patch in, then drop the keys it explicitly sent as null.
        metadata = CASE
            WHEN p_metadata IS NULL THEN profile.metadata
            ELSE (COALESCE(profile.metadata, '{}'::jsonb) || p_metadata)
                 - ARRAY(
                     SELECT key
                       FROM jsonb_each(p_metadata)
                      WHERE jsonb_typeof(value) = 'null'
                   )
        END,
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
-- Restores the 7220 body: metadata replaced wholesale.
CREATE OR REPLACE FUNCTION organization.fn_profile_update(
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

--------------UP
-- One row per organization. `id` = Zitadel organization id.
CREATE TABLE organization.profile (
    id                VARCHAR(120) PRIMARY KEY,
    name              VARCHAR(300),
    display_name      VARCHAR(300),
    timezone_default  VARCHAR(120),
    locale_default    VARCHAR(32),
    metadata          JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ
);
--------------DOWN
DROP TABLE organization.profile;

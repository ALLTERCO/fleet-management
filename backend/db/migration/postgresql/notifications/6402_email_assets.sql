--------------UP
-- Binary email attachments stored in-DB. Referenced from email templates
-- and endpoint configs via `attachments[].assetId`; dedup by sha256 per
-- org so the same logo uploaded twice reuses one row.

CREATE TABLE notifications.email_assets (
    id              SERIAL       PRIMARY KEY,
    organization_id VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    filename        VARCHAR(255) NOT NULL,
    content_type    VARCHAR(120) NOT NULL,
    size_bytes      INTEGER      NOT NULL CHECK (size_bytes > 0),
    sha256          CHAR(64)     NOT NULL,
    bytes           BYTEA        NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT email_assets_filename_nonempty CHECK (length(trim(filename)) > 0),
    CONSTRAINT email_assets_content_type_nonempty CHECK (length(trim(content_type)) > 0),
    CONSTRAINT email_assets_sha256_hex CHECK (sha256 ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX email_assets_sha256_by_org
    ON notifications.email_assets (organization_id, sha256);
CREATE INDEX email_assets_by_org
    ON notifications.email_assets (organization_id, created_at DESC);

--------------DOWN
DROP INDEX IF EXISTS notifications.email_assets_by_org;
DROP INDEX IF EXISTS notifications.email_assets_sha256_by_org;
DROP TABLE IF EXISTS notifications.email_assets;

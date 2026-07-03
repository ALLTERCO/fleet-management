--------------UP
CREATE TABLE ui.dashboard_template (
    id              BIGSERIAL PRIMARY KEY,
    organization_id VARCHAR(120),
    key             VARCHAR(120) NOT NULL,
    label           VARCHAR(200) NOT NULL,
    description     TEXT,
    dashboard_type  VARCHAR(40) NOT NULL,
    seed            JSONB NOT NULL,
    is_builtin      BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ,
    UNIQUE (organization_id, key)
);
CREATE INDEX dashboard_template_type ON ui.dashboard_template (dashboard_type);
CREATE INDEX dashboard_template_builtin ON ui.dashboard_template (is_builtin) WHERE is_builtin;
--------------DOWN
DROP TABLE ui.dashboard_template;

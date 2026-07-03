--------------UP
-- Saved, named report configurations an org can re-run with one click. params
-- is the stored Report.Generate(Energy) param object; sections_enabled is an
-- optional allowlist of role-gated section ids (NULL = all triggered sections).
CREATE TABLE IF NOT EXISTS organization.report_templates (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    description      TEXT,
    kind             TEXT NOT NULL CHECK (kind IN ('energy', 'unified')),
    params           JSONB NOT NULL,
    sections_enabled TEXT[],
    created_by       VARCHAR(120),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ
);

-- One template name per org, case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS report_templates_org_name_unique
    ON organization.report_templates (organization_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_report_templates_org
    ON organization.report_templates (organization_id);

--------------DOWN
DROP TABLE IF EXISTS organization.report_templates;

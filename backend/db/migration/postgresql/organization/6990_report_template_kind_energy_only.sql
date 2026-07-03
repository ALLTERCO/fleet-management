--------------UP
-- Report templates are energy-only; the 'unified' kind was never wired for
-- creation or run. Tighten the CHECK so the schema matches the app.
ALTER TABLE organization.report_templates
    DROP CONSTRAINT IF EXISTS report_templates_kind_check;
ALTER TABLE organization.report_templates
    ADD CONSTRAINT report_templates_kind_check CHECK (kind IN ('energy'));

--------------DOWN
ALTER TABLE organization.report_templates
    DROP CONSTRAINT IF EXISTS report_templates_kind_check;
ALTER TABLE organization.report_templates
    ADD CONSTRAINT report_templates_kind_check
    CHECK (kind IN ('energy', 'unified'));

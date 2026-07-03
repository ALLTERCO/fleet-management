--------------UP
-- Report templates run through the one report entrypoint (report.Generate),
-- which supports three kinds. Widen the CHECK to match.
ALTER TABLE organization.report_templates
    DROP CONSTRAINT IF EXISTS report_templates_kind_check;
ALTER TABLE organization.report_templates
    ADD CONSTRAINT report_templates_kind_check
    CHECK (kind IN ('energy', 'timeseries', 'raw'));

--------------DOWN
ALTER TABLE organization.report_templates
    DROP CONSTRAINT IF EXISTS report_templates_kind_check;
ALTER TABLE organization.report_templates
    ADD CONSTRAINT report_templates_kind_check CHECK (kind IN ('energy'));

--------------UP
-- Append-only audit trail for every fm.energy_classification mutation.
-- Each row captures the BEFORE → AFTER snapshot + who + when. Source
-- distinguishes hand-set rows ('create'/'update'/'delete') from
-- bulk-applied preset rows ('preset_apply').

CREATE TABLE IF NOT EXISTS fm.energy_classification_audit (
    ts             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    device         INT NOT NULL,
    component_key  VARCHAR(100) NOT NULL,
    who            VARCHAR(200) NULL,
    old_tag        VARCHAR(30) NULL,
    old_domain     VARCHAR(16) NULL,
    new_tag        VARCHAR(30) NULL,
    new_domain     VARCHAR(16) NULL,
    source         VARCHAR(16) NOT NULL,
    CONSTRAINT energy_classification_audit_source_chk CHECK (
        source IN ('create', 'update', 'delete', 'preset_apply')
    )
);

CREATE INDEX IF NOT EXISTS energy_classification_audit_device_idx
    ON fm.energy_classification_audit (device, ts DESC);

COMMENT ON TABLE fm.energy_classification_audit IS
    'Append-only audit log for fm.energy_classification mutations.';
--------------DOWN
DROP TABLE IF EXISTS fm.energy_classification_audit;

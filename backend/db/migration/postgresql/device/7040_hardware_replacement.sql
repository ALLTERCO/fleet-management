--------------UP
CREATE TABLE IF NOT EXISTS device.hardware_replacement_audit (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id    VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    old_device_id      INT NOT NULL,
    new_device_id      INT NOT NULL,
    old_external_id    VARCHAR(50) NOT NULL,
    new_external_id    VARCHAR(50) NOT NULL,
    confirmed_by       VARCHAR(320) NULL,
    compatibility      VARCHAR(32) NOT NULL,
    mapping            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT hardware_replacement_compatibility_chk CHECK (
        compatibility IN ('exact_match', 'compatible_mapping')
    )
);

CREATE INDEX IF NOT EXISTS hardware_replacement_audit_org_idx
    ON device.hardware_replacement_audit (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hardware_replacement_audit_old_device_idx
    ON device.hardware_replacement_audit (old_device_id);

COMMENT ON TABLE device.hardware_replacement_audit IS
    'Audit log for physical hardware replacement on a stable Fleet device id.';

CREATE OR REPLACE FUNCTION device.fn_replace_hardware(
    p_organization_id VARCHAR,
    p_old_external_id VARCHAR,
    p_new_external_id VARCHAR,
    p_confirmed_by VARCHAR,
    p_compatibility VARCHAR,
    p_mapping JSONB
)
RETURNS TABLE (
    device_id INT,
    old_external_id VARCHAR,
    new_external_id VARCHAR,
    audit_id BIGINT
)
AS
$$
DECLARE
    v_old device.list%ROWTYPE;
    v_new device.list%ROWTYPE;
    v_audit_id BIGINT;
BEGIN
    IF p_organization_id IS NULL OR p_organization_id = '' THEN
        RAISE EXCEPTION 'organization is required';
    END IF;
    IF p_old_external_id IS NULL OR p_old_external_id = ''
        OR p_new_external_id IS NULL OR p_new_external_id = ''
    THEN
        RAISE EXCEPTION 'old and new external ids are required';
    END IF;
    IF p_old_external_id = p_new_external_id THEN
        RAISE EXCEPTION 'old and new external ids must differ';
    END IF;
    IF p_compatibility NOT IN ('exact_match', 'compatible_mapping') THEN
        RAISE EXCEPTION 'unsupported compatibility %', p_compatibility;
    END IF;

    LOCK TABLE device.list IN SHARE ROW EXCLUSIVE MODE;

    SELECT *
      INTO v_old
      FROM device.list
     WHERE external_id = p_old_external_id
       AND organization_id = p_organization_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'old device % not found in organization %',
            p_old_external_id, p_organization_id;
    END IF;

    SELECT *
      INTO v_new
      FROM device.list
     WHERE external_id = p_new_external_id
       AND organization_id = p_organization_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'new device % not found in organization %',
            p_new_external_id, p_organization_id;
    END IF;

    DELETE FROM device.list
     WHERE id = v_new.id;

    UPDATE device.list
       SET external_id = p_new_external_id,
           jdoc = COALESCE(v_new.jdoc, v_old.jdoc),
           control_access = v_new.control_access,
           updated = now()::TIMESTAMPTZ
     WHERE id = v_old.id;

    INSERT INTO device.hardware_replacement_audit (
        organization_id, old_device_id, new_device_id,
        old_external_id, new_external_id, confirmed_by,
        compatibility, mapping
    )
    VALUES (
        p_organization_id, v_old.id, v_new.id,
        p_old_external_id, p_new_external_id, p_confirmed_by,
        p_compatibility, COALESCE(p_mapping, '{}'::jsonb)
    )
    RETURNING id INTO v_audit_id;

    RETURN QUERY
    SELECT v_old.id, p_old_external_id, p_new_external_id, v_audit_id;
END;
$$
LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_replace_hardware(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB
);
DROP TABLE IF EXISTS device.hardware_replacement_audit;

--------------UP
-- Two read paths: fleet-wide (p_device IS NULL) and per-device. One
-- function so the repository has a single call site for both shapes.

CREATE OR REPLACE FUNCTION fm.fn_list_energy_classifications(
    p_device INT DEFAULT NULL
)
RETURNS TABLE (
    device              INT,
    component_key       VARCHAR(100),
    tag                 VARCHAR(30),
    domain              VARCHAR(16),
    channel             SMALLINT,
    classifier_source   VARCHAR(16),
    declared_at         TIMESTAMP WITH TIME ZONE,
    declared_by         VARCHAR(200)
)
AS $$
    SELECT device, component_key, tag, domain, channel,
        classifier_source, declared_at, declared_by
    FROM fm.energy_classification
    WHERE p_device IS NULL OR device = p_device
    ORDER BY device, component_key;
$$
LANGUAGE sql;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_list_energy_classifications(INT);

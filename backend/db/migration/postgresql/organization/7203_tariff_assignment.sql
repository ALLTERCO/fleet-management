--------------UP
-- Attaches a tariff to a metering point. Resolution is most-specific-wins:
-- channel (device+channel) -> device -> dashboard default. Handles a Pro 3EM in
-- monophase profile where each channel is a separate single-phase circuit.
CREATE TABLE organization.tariff_assignment (
    id                 INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    organization_id    VARCHAR(120) NOT NULL
                         REFERENCES organization.profile(id) ON DELETE CASCADE,
    tariff_id          INTEGER NOT NULL REFERENCES organization.tariff(id) ON DELETE CASCADE,
    scope_level        VARCHAR(10) NOT NULL
                         CHECK (scope_level IN ('dashboard','device','channel')),
    dashboard_id       INTEGER,
    device_external_id VARCHAR(50),
    channel            SMALLINT,
    CHECK (
        (scope_level = 'dashboard' AND dashboard_id IS NOT NULL)
     OR (scope_level = 'device'    AND device_external_id IS NOT NULL)
     OR (scope_level = 'channel'   AND device_external_id IS NOT NULL AND channel IS NOT NULL)
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS organization__tariff_assignment_point
  ON organization.tariff_assignment
     (organization_id, scope_level, COALESCE(dashboard_id,-1),
      COALESCE(device_external_id,''), COALESCE(channel,-1))
  NULLS NOT DISTINCT;
--------------DOWN
DROP TABLE IF EXISTS organization.tariff_assignment;

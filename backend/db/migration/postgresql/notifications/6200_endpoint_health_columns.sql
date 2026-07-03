--------------UP
-- Endpoint health: consecutive-failure counter drives auto-disable;
-- quiet-hours window (stored as local-time + tz) lets the delivery
-- loop skip (not drop) jobs during ops-defined off-hours.
ALTER TABLE notifications.integration_endpoints
    ADD COLUMN consecutive_failures INTEGER      NOT NULL DEFAULT 0,
    ADD COLUMN last_success_at      TIMESTAMPTZ,
    ADD COLUMN last_failure_at      TIMESTAMPTZ,
    ADD COLUMN auto_disabled_at     TIMESTAMPTZ,
    ADD COLUMN disable_reason       VARCHAR(120),
    ADD COLUMN quiet_hours_start    INTEGER,
    ADD COLUMN quiet_hours_end      INTEGER,
    ADD COLUMN quiet_hours_tz       VARCHAR(60)  NOT NULL DEFAULT 'UTC',
    ADD CONSTRAINT integration_endpoints_quiet_hours_start_valid
        CHECK (quiet_hours_start IS NULL
               OR (quiet_hours_start >= 0 AND quiet_hours_start <= 23)),
    ADD CONSTRAINT integration_endpoints_quiet_hours_end_valid
        CHECK (quiet_hours_end IS NULL
               OR (quiet_hours_end >= 0 AND quiet_hours_end <= 23)),
    ADD CONSTRAINT integration_endpoints_quiet_hours_paired
        CHECK ((quiet_hours_start IS NULL) = (quiet_hours_end IS NULL)),
    ADD CONSTRAINT integration_endpoints_consecutive_failures_non_negative
        CHECK (consecutive_failures >= 0);
--------------DOWN
ALTER TABLE notifications.integration_endpoints
    DROP CONSTRAINT IF EXISTS integration_endpoints_quiet_hours_start_valid,
    DROP CONSTRAINT IF EXISTS integration_endpoints_quiet_hours_end_valid,
    DROP CONSTRAINT IF EXISTS integration_endpoints_quiet_hours_paired,
    DROP CONSTRAINT IF EXISTS integration_endpoints_consecutive_failures_non_negative,
    DROP COLUMN IF EXISTS consecutive_failures,
    DROP COLUMN IF EXISTS last_success_at,
    DROP COLUMN IF EXISTS last_failure_at,
    DROP COLUMN IF EXISTS auto_disabled_at,
    DROP COLUMN IF EXISTS disable_reason,
    DROP COLUMN IF EXISTS quiet_hours_start,
    DROP COLUMN IF EXISTS quiet_hours_end,
    DROP COLUMN IF EXISTS quiet_hours_tz;

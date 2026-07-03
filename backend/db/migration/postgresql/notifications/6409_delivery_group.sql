--------------UP
-- Alert grouping (Alertmanager-style). Open groups accumulate alerts
-- sharing a group_key_hash; one flush task per group emits a single
-- notification per endpoint listing N alerts. Stops 7k-device storms
-- from producing 7k notifications.

CREATE TABLE notifications.delivery_group (
    id                BIGSERIAL    PRIMARY KEY,
    organization_id   VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    rule_id           INTEGER      NOT NULL REFERENCES notifications.alert_rules(id) ON DELETE CASCADE,
    group_key_hash    BYTEA        NOT NULL,
    group_key         JSONB        NOT NULL,
    first_alert_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_alert_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_notified_at  TIMESTAMPTZ,
    resolved_at       TIMESTAMPTZ,
    state             TEXT         NOT NULL DEFAULT 'open'
        CHECK (state IN ('open','flushed','resolved')),
    member_count      INTEGER      NOT NULL DEFAULT 0
);

-- At most one open group per group_key_hash. Flushed/resolved groups
-- stay in the table for audit + repeat_interval tracking.
CREATE UNIQUE INDEX delivery_group_open_key
    ON notifications.delivery_group (group_key_hash)
    WHERE state = 'open';

CREATE INDEX delivery_group_by_org_state
    ON notifications.delivery_group (organization_id, state);

CREATE TABLE notifications.delivery_group_member (
    group_id     BIGINT       NOT NULL REFERENCES notifications.delivery_group(id) ON DELETE CASCADE,
    alert_id     INTEGER      NOT NULL REFERENCES notifications.alert_instances(id) ON DELETE CASCADE,
    endpoint_id  INTEGER      NOT NULL REFERENCES notifications.integration_endpoints(id) ON DELETE CASCADE,
    added_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, alert_id, endpoint_id)
);

CREATE INDEX delivery_group_member_by_alert
    ON notifications.delivery_group_member (alert_id);

--------------DOWN
DROP TABLE IF EXISTS notifications.delivery_group_member;
DROP TABLE IF EXISTS notifications.delivery_group;

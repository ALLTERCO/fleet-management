--------------UP
-- Dashboard owner column + activity log table. Owner is the user who
-- created the dashboard (or to whom ownership was reassigned); activity
-- log captures share/edit/clone events keyed by (dashboard_id, occurred_at)
-- so the share panel can render the last N events without scanning the
-- audit firehose.

ALTER TABLE ui.dashboard
    ADD COLUMN IF NOT EXISTS owner_user_id VARCHAR(120) NULL;

-- Index supports "dashboards I own" listings without sequential scan.
CREATE INDEX IF NOT EXISTS dashboard_owner_user_idx
    ON ui.dashboard (owner_user_id)
    WHERE owner_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ui.dashboard_activity_log (
    id                BIGSERIAL    PRIMARY KEY,
    dashboard_id      INTEGER      NOT NULL REFERENCES ui.dashboard(id) ON DELETE CASCADE,
    organization_id   VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    actor_user_id     VARCHAR(120) NULL,
    event_kind        VARCHAR(40)  NOT NULL,
    detail            JSONB        NOT NULL DEFAULT '{}'::jsonb,
    occurred_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT dashboard_activity_event_kind_known
        CHECK (event_kind IN ('created', 'updated', 'shared', 'unshared',
                              'cloned', 'pinned', 'unpinned',
                              'owner_changed', 'item_added', 'item_removed')),
    CONSTRAINT dashboard_activity_detail_object
        CHECK (jsonb_typeof(detail) = 'object')
);

CREATE INDEX IF NOT EXISTS dashboard_activity_by_dashboard
    ON ui.dashboard_activity_log (dashboard_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS dashboard_activity_by_org_recent
    ON ui.dashboard_activity_log (organization_id, occurred_at DESC);

--------------DOWN
DROP INDEX IF EXISTS ui.dashboard_activity_by_org_recent;
DROP INDEX IF EXISTS ui.dashboard_activity_by_dashboard;
DROP TABLE IF EXISTS ui.dashboard_activity_log;
DROP INDEX IF EXISTS ui.dashboard_owner_user_idx;
ALTER TABLE ui.dashboard DROP COLUMN IF EXISTS owner_user_id;

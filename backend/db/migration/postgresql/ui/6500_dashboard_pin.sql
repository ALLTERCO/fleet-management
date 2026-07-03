--------------UP
CREATE TABLE ui.dashboard_pin (
    user_id      VARCHAR(120) NOT NULL,
    dashboard_id BIGINT NOT NULL REFERENCES ui.dashboard(id) ON DELETE CASCADE,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    pinned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, dashboard_id)
);
CREATE INDEX dashboard_pin_user_sort ON ui.dashboard_pin (user_id, sort_order);
--------------DOWN
DROP TABLE ui.dashboard_pin;

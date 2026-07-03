--------------UP
CREATE TABLE ui.dashboard_order_user (
    user_id       VARCHAR(120) NOT NULL,
    dashboard_id  BIGINT NOT NULL REFERENCES ui.dashboard(id) ON DELETE CASCADE,
    display_order INTEGER NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, dashboard_id)
);
CREATE INDEX dashboard_order_user_idx
    ON ui.dashboard_order_user (user_id, display_order);
--------------DOWN
DROP TABLE ui.dashboard_order_user;

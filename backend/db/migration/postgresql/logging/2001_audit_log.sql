--------------UP
CREATE TABLE logging.audit_log (
    id              SERIAL,
    ts              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    event_type      VARCHAR(50)     NOT NULL,
    username        VARCHAR(255),
    shelly_id       VARCHAR(255),
    method          VARCHAR(255),
    params          JSONB,
    success         BOOLEAN         DEFAULT TRUE,
    error_message   TEXT,
    ip_address      VARCHAR(45),
    PRIMARY KEY (id, ts)
);

SELECT create_hypertable('logging.audit_log', 'ts', if_not_exists => TRUE);

CREATE INDEX idx_audit_log_event_type ON logging.audit_log (event_type, ts DESC);
CREATE INDEX idx_audit_log_username ON logging.audit_log (username, ts DESC);
CREATE INDEX idx_audit_log_shelly_id ON logging.audit_log (shelly_id, ts DESC);
CREATE INDEX idx_audit_log_ts ON logging.audit_log (ts DESC);

--------------DOWN
DROP TABLE logging.audit_log;

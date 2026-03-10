--------------UP
CREATE INDEX IF NOT EXISTS device__status_id_field_ts
    ON device.status USING btree (id, field, ts DESC);
--------------DOWN
DROP INDEX IF EXISTS device.device__status_id_field_ts;

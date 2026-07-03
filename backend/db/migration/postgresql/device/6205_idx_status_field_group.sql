--------------UP
-- Composite index for fn_status_environmental_history and the LIKE-pattern
-- queries in fn_fleet_energy_summary.
--
-- Query shape is: WHERE id = ANY(...) AND field_group LIKE '...' AND ts
-- BETWEEN ... AND ... The equality on id makes the index highly selective;
-- leading with id lets Postgres pick the chunk and partition, and the
-- trailing ts DESC keeps the bucket output already ordered.
--
-- field_group LIKE 'prefix:%' benefits from prefix match; arbitrary
-- infix matches will still scan, but that path is not used by
-- fn_status_environmental_history.
CREATE INDEX IF NOT EXISTS device__status_id_field_group_ts
    ON device.status
    USING btree (id, field_group, ts DESC);
--------------DOWN
DROP INDEX IF EXISTS device__status_id_field_group_ts;

-- Keep raw writes and dirty markers atomic without transferring unused readings.
--------------UP
CREATE OR REPLACE FUNCTION device_em.fn_append_stats_dirty_count(
    p_device INT[],
    p_tag VARCHAR(30)[],
    p_domain VARCHAR(16)[],
    p_phase VARCHAR(1)[],
    p_channel SMALLINT[],
    p_ts BIGINT[],
    p_val REAL[],
    p_source VARCHAR(16)
)
RETURNS BIGINT
LANGUAGE sql
AS
$$
    SELECT count(*)
    FROM device_em.fn_append_stats_dirty(
        p_device, p_tag, p_domain, p_phase, p_channel, p_ts, p_val, p_source
    );
$$;

--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_append_stats_dirty_count(
    INT[], VARCHAR[], VARCHAR[], VARCHAR[], SMALLINT[], BIGINT[], REAL[], VARCHAR
);

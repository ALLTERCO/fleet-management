--------------UP
SET search_path TO device_em, public;

CREATE OR REPLACE FUNCTION device_em.fn_drop_rolled_up_stats(
    p_retention_days INT DEFAULT 31
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
AS
$$
DECLARE
    v_oldest_dirty TIMESTAMPTZ;
    v_horizon      TIMESTAMPTZ;
BEGIN
    SELECT d.bucket
    INTO v_oldest_dirty
    FROM device_em.rollup_dirty d
    ORDER BY d.id
    LIMIT 1;

    v_horizon := now() - make_interval(days => p_retention_days);
    IF v_oldest_dirty IS NOT NULL THEN
        v_horizon := LEAST(v_horizon, v_oldest_dirty);
    END IF;

    PERFORM drop_chunks('device_em.stats', older_than => v_horizon);
    RETURN v_horizon;
END;
$$;

--------------DOWN
SET search_path TO device_em, public;

CREATE OR REPLACE FUNCTION device_em.fn_drop_rolled_up_stats(
    p_retention_days INT DEFAULT 31
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
AS
$$
DECLARE
    v_rollup_max TIMESTAMPTZ;
    v_horizon    TIMESTAMPTZ;
BEGIN
    SELECT max(bucket) INTO v_rollup_max FROM device_em.energy_15min;
    IF v_rollup_max IS NULL THEN
        RETURN NULL;
    END IF;
    v_horizon := LEAST(
        now() - make_interval(days => p_retention_days),
        v_rollup_max
    );
    PERFORM drop_chunks('device_em.stats', older_than => v_horizon);
    RETURN v_horizon;
END;
$$;

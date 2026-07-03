--------------UP
-- Wrong volatility. severity-floor reads tables; fingerprint reads NOW().
-- IMMUTABLE let Postgres const-fold a stale severity floor and collapse
-- per-fire fingerprints. Declare the honest volatility (no body change).
ALTER FUNCTION notifications.fn_apply_group_severity_floor(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR
) STABLE;
ALTER FUNCTION notifications.fn_compute_fingerprint_v2(
    BIGINT, VARCHAR, VARCHAR, VARCHAR, JSONB, BIGINT
) VOLATILE;
--------------DOWN
ALTER FUNCTION notifications.fn_apply_group_severity_floor(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR
) IMMUTABLE;
ALTER FUNCTION notifications.fn_compute_fingerprint_v2(
    BIGINT, VARCHAR, VARCHAR, VARCHAR, JSONB, BIGINT
) IMMUTABLE;

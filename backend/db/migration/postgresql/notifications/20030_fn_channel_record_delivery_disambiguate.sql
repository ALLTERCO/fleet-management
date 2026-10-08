--------------UP
-- Migration 20021 reintroduced the retired three-argument overload after
-- migration 7316 had replaced it with the four-argument function. Because the
-- fourth argument has a default, PostgreSQL cannot choose between the two for
-- normal three-argument delivery calls. Keep the four-argument function as the
-- only implementation and let its default preserve the public three-argument
-- call contract.
DO $$
BEGIN
    IF to_regprocedure(
        'notifications.fn_channel_record_delivery(integer,character varying,integer,boolean)'
    ) IS NULL THEN
        RAISE EXCEPTION 'four-argument fn_channel_record_delivery is missing';
    END IF;
END;
$$;

-- Remove the obsolete overload that makes every three-argument call ambiguous
-- with the authoritative defaulted function.
-- LINT-IGNORE: additive-only -- deliberate obsolete-overload removal.
DROP FUNCTION IF EXISTS notifications.fn_channel_record_delivery(
    INTEGER, VARCHAR, INTEGER
);

--------------DOWN
-- Restore the pre-migration overload. Delegate to the authoritative
-- four-argument implementation so rollback does not duplicate health logic.
CREATE OR REPLACE FUNCTION notifications.fn_channel_record_delivery(
    p_endpoint_id       INTEGER,
    p_status            VARCHAR,
    p_autooff_threshold INTEGER DEFAULT 10
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
    SELECT notifications.fn_channel_record_delivery(
        p_endpoint_id,
        p_status,
        p_autooff_threshold,
        TRUE
    );
$$;

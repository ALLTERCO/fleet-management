--------------UP
-- 6418 added a 2-arg overload that collides with 6417's 3-arg variant
-- (whose third arg has DEFAULT NULL → callable with 2 args). PostgreSQL
-- raises "function ... is not unique" on every Integration.Endpoint.Create.
-- Drop the redundant overload; 2-arg callers land on 6417's defaulted form.
DROP FUNCTION IF EXISTS notifications.fn_integration_endpoint_secret_set(INTEGER, TEXT);

--------------DOWN
-- Re-running 6418 restores the legacy 2-arg shim.

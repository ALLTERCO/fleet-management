--------------UP
-- Cutover: open pending devices now live only in the Redis store. Drop the
-- stale DB 'open' rows; each device re-enters the store on reconnect.
DELETE FROM organization.device_ingress_waiting_room
 WHERE state = 'open';

--------------DOWN
-- Throwaway rows; reconnect repopulates the store. No-op.

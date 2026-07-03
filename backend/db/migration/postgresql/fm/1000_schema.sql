--------------UP
CREATE SCHEMA IF NOT EXISTS fm;
COMMENT ON SCHEMA fm IS
    'FM-managed metadata — operator-controlled state distinct from device-emitted data.';
--------------DOWN
DROP SCHEMA IF EXISTS fm;

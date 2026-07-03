--------------UP
-- Retire dead energy-classification SQL. The preset RPC methods and the
-- DeleteClassification method are gone; SetPointOverride keeps only
-- upsert (6000) + list (6002). These four functions have no caller left.
-- Tables (fm.energy_preset*, fm.energy_classification) stay per the
-- additive-only policy — only the unreachable functions are dropped.

DROP FUNCTION IF EXISTS fm.fn_save_energy_preset(
    VARCHAR(200), VARCHAR(200), VARCHAR(200),
    VARCHAR(100)[], VARCHAR(30)[], VARCHAR(16)[], SMALLINT[]
);
DROP FUNCTION IF EXISTS fm.fn_apply_energy_preset(INT, BIGINT, VARCHAR(200));
DROP FUNCTION IF EXISTS fm.fn_list_energy_presets();
DROP FUNCTION IF EXISTS fm.fn_delete_energy_classification(
    INT, VARCHAR(100), VARCHAR(200)
);
--------------DOWN
-- No rollback: the dropped functions were unreachable dead code. The
-- preset and classification tables they touched remain intact, so a
-- re-create would only reintroduce orphaned functions.

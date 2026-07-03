--------------UP
-- Phase 3: drop legacy item columns. Readers + writers are on typed cols.
-- LINT-IGNORE: additive-only
ALTER TABLE ui.dashboard_item
-- LINT-IGNORE: additive-only
    DROP COLUMN type,
-- LINT-IGNORE: additive-only
    DROP COLUMN item,
-- LINT-IGNORE: additive-only
    DROP COLUMN sub_item;
--------------DOWN
ALTER TABLE ui.dashboard_item
    ADD COLUMN type     INT,
    ADD COLUMN item     INT,
    ADD COLUMN sub_item VARCHAR(250);

--------------UP
-- One-shot cleanup: remove dashboards left over by the api-test integration
-- run before commit ad8776d4 fixed the after() hook. The pattern is unique
-- to that test path (`__api_test_dashboard_<unix-ms>`); no production
-- caller creates rows with that prefix.
DELETE FROM ui.dashboard_item
 WHERE dashboard IN (
    SELECT id FROM ui.dashboard WHERE name LIKE '\_\_api\_test\_dashboard\_%' ESCAPE '\'
 );
DELETE FROM ui.dashboard
 WHERE name LIKE '\_\_api\_test\_dashboard\_%' ESCAPE '\';
--------------DOWN
-- One-shot cleanup. No restore: the deleted rows were test artifacts.
SELECT 1;

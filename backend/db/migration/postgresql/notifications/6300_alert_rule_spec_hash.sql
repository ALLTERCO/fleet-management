--------------UP
-- spec_hash captures the subset of columns that define a rule's
-- identity for duplicate detection: kind + severity + what it fires
-- on + how it throttles. Name / templates / destinations / owner are
-- intentionally excluded — two rules that trigger on the same thing
-- are the duplicate UX targets even if they differ in wording or
-- notification target.
--
-- JSONB::text is deterministic (canonical key order), so md5 of the
-- concatenation stays stable across identical specs.
ALTER TABLE notifications.alert_rules
    ADD COLUMN spec_hash CHAR(32) GENERATED ALWAYS AS (
        md5(
            kind                          || '|' ||
            severity                      || '|' ||
            scope::text                   || '|' ||
            config::text                  || '|' ||
            dedupe_window_sec::text       || '|' ||
            cooldown_sec::text
        )
    ) STORED;

CREATE INDEX alert_rules_by_org_spec_hash
    ON notifications.alert_rules (organization_id, spec_hash);
--------------DOWN
DROP INDEX IF EXISTS notifications.alert_rules_by_org_spec_hash;
ALTER TABLE notifications.alert_rules DROP COLUMN IF EXISTS spec_hash;

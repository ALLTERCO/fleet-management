--------------UP
-- Adds the canonical (tag, domain) primitive to device_em.stats. Existing
-- rows logically inherit domain='ac_mains' since every previously-captured
-- row came from a Shelly EM/PM/Switch+PM/etc. component, which are all
-- AC-mains by hardware design. classifier_source is diagnostic: lets us
-- trace per-row which classifier tier produced it.
ALTER TABLE device_em.stats ADD COLUMN domain VARCHAR(16) NOT NULL DEFAULT 'ac_mains';
ALTER TABLE device_em.stats ADD COLUMN classifier_source VARCHAR(16) NULL;
--------------DOWN
ALTER TABLE device_em.stats DROP COLUMN IF EXISTS classifier_source;
ALTER TABLE device_em.stats DROP COLUMN IF EXISTS domain;

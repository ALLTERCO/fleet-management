--------------UP
-- Two additive columns on organization.certificates:
--   metadata jsonb — extended X.509 metadata (signature_algorithm,
--     serial_number, key_bits, key_curve, subject_o/ou, issuer_o/ou,
--     split SANs, key_usage, extended_key_usage, chain_includes_root).
--     Stored as JSONB so future fields don't need migrations.
--   tags text[] — operator-controlled labels for grouping certs
--     across a fleet (e.g., ['prod', 'building-A', 'mtls-leaf']).
--     GIN index supports tag filter in fn_certificate_list.

SET search_path TO organization;

ALTER TABLE organization.certificates
    ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE organization.certificates
    ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];

-- VARCHAR has no GIN opclass; tag filter uses GIN on tags alone.
CREATE INDEX IF NOT EXISTS certificates_tags_gin
    ON organization.certificates USING gin (tags);

--------------DOWN
SET search_path TO organization;

DROP INDEX IF EXISTS organization.certificates_tags_gin;
ALTER TABLE organization.certificates DROP COLUMN IF EXISTS tags;
ALTER TABLE organization.certificates DROP COLUMN IF EXISTS metadata;

--------------UP
-- Saved setup bundles held the raw device key in the ws server address
-- (?id=...&token=...) and were never cleaned up. Rotate the exposed key for
-- every identity that still relies on it, then scrub the stored address so
-- the plaintext key stops sitting in the row.
CREATE OR REPLACE FUNCTION organization.fn_ingress_enqueue_exposed_key_rotation()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    v_count integer;
BEGIN
    WITH session_token AS (
        SELECT
            s.organization_id,
            (s.bundle->>'identityId')::uuid AS identity_id,
            substring(
                s.bundle->'deviceConfig'->'ws'->>'server' FROM 'token=([^&]*)'
            ) AS token_value
          FROM organization.device_ingress_setup_session s
         WHERE s.bundle->'deviceConfig'->'ws'->>'server' LIKE '%token=%'
           AND s.bundle->>'identityId' ~*
               '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
    -- The exposed credential per identity: the token whose prefix matches the
    -- key that sat in the saved address. Prefer the active one when both an
    -- active and a pending row happen to share a prefix collision window.
    exposed_credential AS (
        SELECT DISTINCT ON (st.organization_id, st.identity_id)
               st.organization_id, st.identity_id, c.id AS credential_id
          FROM session_token st
          JOIN organization.device_ingress_credential c
            ON c.organization_id = st.organization_id
           AND c.identity_id = st.identity_id
           AND c.credential_type = 'token'
           AND c.state IN ('active', 'pending')
           -- Exact prefix compare, not LIKE: token_prefix holds a literal "_",
           -- which LIKE treats as a single-char wildcard.
           AND left(st.token_value, length(c.token_prefix)) = c.token_prefix
         ORDER BY st.organization_id, st.identity_id,
                  (c.state = 'active') DESC, c.created_at DESC
    ),
    eligible AS (
        SELECT ec.organization_id, ec.identity_id, ec.credential_id
          FROM exposed_credential ec
          JOIN organization.device_ingress_identity i
            ON i.id = ec.identity_id AND i.organization_id = ec.organization_id
           AND i.status = 'active'
         WHERE NOT EXISTS (
             SELECT 1 FROM organization.device_ingress_rotation_job j
              WHERE j.identity_id = ec.identity_id
                AND j.organization_id = ec.organization_id
                AND j.state IN ('queued', 'sent', 'waiting')
         )
    ),
    -- One batch id per organization, so one enqueue run reads as one batch.
    org_batch AS (
        SELECT DISTINCT organization_id, gen_random_uuid() AS batch_id
          FROM eligible
    ),
    inserted AS (
        INSERT INTO organization.device_ingress_rotation_job (
            organization_id, batch_id, created_by, identity_id, old_credential_id
        )
        SELECT e.organization_id, ob.batch_id, 'system:exposed-key-rotation',
               e.identity_id, e.credential_id
          FROM eligible e
          JOIN org_batch ob ON ob.organization_id = e.organization_id
        RETURNING 1
    )
    SELECT count(*) INTO v_count FROM inserted;
    RETURN COALESCE(v_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_ingress_scrub_setup_bundle_tokens()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    v_count integer;
BEGIN
    WITH scrubbed AS (
        UPDATE organization.device_ingress_setup_session s
           SET bundle = jsonb_set(
                   s.bundle,
                   '{deviceConfig,ws,server}',
                   to_jsonb(
                       -- token is the sole param ("?token=...") -> drop the "?" too.
                       regexp_replace(
                           -- token leads other params ("?token=...&x=y") -> keep "?".
                           regexp_replace(
                               -- token elsewhere ("&token=...") -> drop just that pair.
                               regexp_replace(
                                   s.bundle->'deviceConfig'->'ws'->>'server',
                                   '&token=[^&]*', ''
                               ),
                               '\?token=[^&]*&', '?'
                           ),
                           '\?token=[^&]*$', ''
                       )
                   ),
                   false
               ),
               updated_at = now()
         WHERE s.bundle->'deviceConfig'->'ws'->>'server' LIKE '%token=%'
        RETURNING 1
    )
    SELECT count(*) INTO v_count FROM scrubbed;
    RETURN COALESCE(v_count, 0);
END;
$$;

SELECT organization.fn_ingress_enqueue_exposed_key_rotation();
SELECT organization.fn_ingress_scrub_setup_bundle_tokens();

--------------DOWN
-- Keys already rotated and addresses already scrubbed cannot be restored by a
-- rollback — that is the point: the plaintext key must not come back.
DROP FUNCTION IF EXISTS organization.fn_ingress_enqueue_exposed_key_rotation();
DROP FUNCTION IF EXISTS organization.fn_ingress_scrub_setup_bundle_tokens();

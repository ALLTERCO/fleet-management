--------------UP
-- One-shot cleanup for FM scoped PATs minted before the cross-org gate
-- (UserComponent.createScopedPAT / rotateScopedPAT) checked that the
-- target user_id has at least one assignment or user_group_membership
-- in the issuing tenant. Without that gate an admin in tenant A could
-- mint a PAT for any zitadel userId; when that PAT was used, the auth
-- layer fetched the foreign user's GLOBAL zitadel roles and applied
-- them inside tenant A — a real privilege-escalation path.
--
-- Revoke (soft-delete) every active row whose user has no presence in
-- its tenant. Idempotent: a stale row already revoked is skipped.
--
-- OPERATOR NOTE: the FM auth layer caches user_t entries keyed by token
-- hash for USERINFO_CACHE_TTL_MS (5 min default). This SQL flips
-- revoked_at, but does NOT bust in-memory caches on running instances —
-- a stale PAT presented during that window can still authenticate via
-- the cache. To close the window, restart each FM instance after the
-- migration, or wait for natural cache expiry before considering the
-- cleanup effective.
-- LINT-IGNORE: additive-only
UPDATE organization.fm_scoped_pats p
   SET revoked_at = now()
 WHERE revoked_at IS NULL
   AND NOT EXISTS (
       SELECT 1 FROM organization.assignments a
        WHERE a.tenant_id = p.tenant_id
          AND a.subject_type = 'user'
          AND a.subject_id = p.user_id
   )
   AND NOT EXISTS (
       SELECT 1 FROM organization.user_group_memberships m
              JOIN organization.user_groups g ON m.group_id = g.id
        WHERE g.tenant_id = p.tenant_id
          AND m.user_id = p.user_id
   );
--------------DOWN
-- Soft revocation is irreversible by design: revoked rows stay revoked
-- until the retention sweep hard-deletes them. DOWN is a no-op.
SELECT 1;

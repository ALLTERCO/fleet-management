-- Remap legacy permission tokens after namespace rename (5288b9ad).
-- `auditlog:*` -> `audit:*`, `pluginmgr:*` -> `plugin:*`.
-- Journaled so DOWN reverses exactly the rows this migration rewrote.
--------------UP
CREATE TABLE IF NOT EXISTS "user".list_permissions_rewrite_log (
    id                INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    user_id           INTEGER NOT NULL,
    old_permissions   VARCHAR(255)[] NOT NULL,
    new_permissions   VARCHAR(255)[] NOT NULL,
    rewritten_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

WITH rewrites AS (
    SELECT
        id,
        permissions AS old_permissions,
        (
            SELECT array_agg(
                CASE
                    WHEN p LIKE 'auditlog:%'  THEN 'audit:'  || substring(p FROM 10)
                    WHEN p LIKE 'pluginmgr:%' THEN 'plugin:' || substring(p FROM 11)
                    ELSE p
                END
            )
            FROM unnest(permissions) AS p
        ) AS new_permissions
    FROM "user".list
    WHERE permissions IS NOT NULL
      AND EXISTS (
          SELECT 1 FROM unnest(permissions) p
          WHERE p LIKE 'auditlog:%' OR p LIKE 'pluginmgr:%'
      )
),
logged AS (
    INSERT INTO "user".list_permissions_rewrite_log (user_id, old_permissions, new_permissions)
    SELECT id, old_permissions, new_permissions FROM rewrites
    RETURNING user_id
)
UPDATE "user".list AS u
SET permissions = r.new_permissions
FROM rewrites r
WHERE u.id = r.id;

--------------DOWN
-- Undo exactly the rows UP rewrote. Rows added post-UP with native
-- `audit:*` / `plugin:*` tokens are NOT touched.
UPDATE "user".list AS u
SET permissions = log.old_permissions
FROM "user".list_permissions_rewrite_log AS log
WHERE u.id = log.user_id
  AND u.permissions = log.new_permissions;

DROP TABLE IF EXISTS "user".list_permissions_rewrite_log;

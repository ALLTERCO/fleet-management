--------------UP
-- PR 5 follow-up: the lifetime reconciler compared the latest
-- cumulative reading against the SUM of windowed deltas — apples to
-- oranges, would have alerted 100 % drift on every device running
-- longer than the reconciler window. Per the reset-audit redesign
-- (see docs/architecture/energy-storage-reference.md PR 5 changelog),
-- we drop the comparison entirely and rely on per-(device, channel,
-- tag) reset counts surfaced through Energy.GetResetAudit. This
-- migration is idempotent — IF EXISTS guards cover both fresh and
-- previously-deployed databases.

DROP FUNCTION IF EXISTS device_em.fn_reconcile_lifetime(INT);
--------------DOWN
SELECT 1;

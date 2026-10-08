-- 6534 built the delivery audit unit with unqualified names and never set a
-- search_path, so the schema it landed in was decided by whichever migration
-- happened to run before it. Later migrations changed that order: a fresh
-- database now builds the table, its indexes and its four functions in public,
-- while every already-deployed database has them in notifications.
--
-- DeliveryRecipientAudit.ts calls notifications.fn_delivery_audit_record,
-- notifications.fn_delivery_audit_forget and
-- notifications.fn_delivery_audit_redact_expired by qualified name, so on a
-- fresh install every delivery audit write raises undefined_function and the
-- GDPR forget path has nothing to call.
--
-- Move whatever is still in public. A deployed database has nothing to move and
-- skips both blocks, which is also why this is safe to re-run.

--------------UP

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = 'delivery_recipient_audit'
           AND c.relkind = 'r'
    ) THEN
        ALTER TABLE public.delivery_recipient_audit SET SCHEMA notifications;
    END IF;
END $$;

-- Indexes follow their table. The functions are separate objects and do not.
DO $$
DECLARE
    audit_fn RECORD;
BEGIN
    FOR audit_fn IN
        SELECT p.oid::regprocedure AS signature
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN (
               'fn_audit_recipient_hash',
               'fn_delivery_audit_record',
               'fn_delivery_audit_forget',
               'fn_delivery_audit_redact_expired'
           )
    LOOP
        EXECUTE format(
            'ALTER FUNCTION %s SET SCHEMA notifications',
            audit_fn.signature
        );
    END LOOP;
END $$;

--------------DOWN
-- No-op: moving these back to public would break the qualified callers on
-- every database that already has them in notifications.

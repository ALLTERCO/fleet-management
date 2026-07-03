--------------UP
-- Phase 4e: vacation_until + min_severity. SuppressionEvaluator reads both.

ALTER TABLE notifications.user_notification_preferences
    ADD COLUMN IF NOT EXISTS vacation_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS min_severity VARCHAR(20);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'notifications'
          AND table_name = 'user_notification_preferences'
          AND constraint_name = 'user_notification_preferences_min_severity_valid'
    ) THEN
        ALTER TABLE notifications.user_notification_preferences
            ADD CONSTRAINT user_notification_preferences_min_severity_valid
            CHECK (min_severity IS NULL OR min_severity IN ('info','warning','critical'));
    END IF;
END $$;

--------------DOWN
ALTER TABLE notifications.user_notification_preferences
    DROP CONSTRAINT IF EXISTS user_notification_preferences_min_severity_valid;
ALTER TABLE notifications.user_notification_preferences
    DROP COLUMN IF EXISTS min_severity;
ALTER TABLE notifications.user_notification_preferences
    DROP COLUMN IF EXISTS vacation_until;

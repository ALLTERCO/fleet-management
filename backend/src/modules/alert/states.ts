// SoT for alert_instances.state CHECK values. Mirrors the SQL CHECK in
// db/migration/postgresql/notifications/6520_alert_instance_cleared_states_ack_comment.sql.

export const ALERT_INSTANCE_STATES = [
    'pending',
    'active',
    'acknowledged',
    'recovering',
    'cleared_unack',
    'cleared_ack',
    'no_data',
    'evaluation_error',
    'resolved'
] as const;

export type AlertInstanceState = (typeof ALERT_INSTANCE_STATES)[number];

export const ALERT_INSTANCE_STATE_SET: ReadonlySet<string> = new Set(
    ALERT_INSTANCE_STATES
);

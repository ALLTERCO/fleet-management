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

/**
 * The states that still want a person to look.
 *
 * Deliberately NOT called "open". "Open" already means `resolved_at IS NULL`
 * in SQL — 8 of the 9 states — and it decides which instance owns the
 * (rule_id, fingerprint) slot. See migration 20032. Two meanings under one
 * word is how that one drifted before.
 *
 * `acknowledged` counts: someone owning it is not the problem going away.
 * `cleared_unack` counts too, and is the one people get wrong: the condition
 * stopped but nobody looked. A fridge that warmed overnight and cooled again
 * is exactly what an operator must still see.
 *
 * There is no `'open'` state on the API. Asking for one is silently no rows.
 */
export const ALERT_STATES_NEEDING_ATTENTION = [
    'active',
    'acknowledged',
    'cleared_unack'
] as const satisfies readonly AlertInstanceState[];

export function alertNeedsAttention(state: string | undefined): boolean {
    return (ALERT_STATES_NEEDING_ATTENTION as readonly string[]).includes(
        state ?? ''
    );
}

/**
 * The states that mean "this alert already fired and the condition still
 * stands". A repeat of the same reading is the same alert, not a new one.
 *
 * `cleared_unack` is deliberately absent: the condition stopped, so the next
 * entry into the state is a new one and must be held again.
 */
export const ALERT_STATES_ALREADY_FIRING = [
    'active',
    'acknowledged'
] as const satisfies readonly AlertInstanceState[];

export function alertAlreadyFiring(state: string | undefined): boolean {
    return (ALERT_STATES_ALREADY_FIRING as readonly string[]).includes(
        state ?? ''
    );
}

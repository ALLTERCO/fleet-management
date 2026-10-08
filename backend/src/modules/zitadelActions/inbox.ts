export type ZitadelActionName = 'user.removed' | 'user.grant.removed';

export interface InboxEvent {
    eventKey: string;
    action: ZitadelActionName;
    userId: string;
    payload: unknown;
    sourceIp?: string;
}

type QueryRows = typeof import('../PostgresProvider.js').queryRows;

export async function enqueueZitadelAction(
    event: InboxEvent,
    queryRows?: QueryRows
): Promise<{inserted: boolean}> {
    const execute: QueryRows =
        queryRows ?? (await import('../PostgresProvider.js')).queryRows;
    const rows = await execute<{inserted: boolean}>(
        `INSERT INTO organization.zitadel_action_inbox
             (event_key, action, user_id, payload, source_ip)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT (event_key) DO NOTHING
         RETURNING TRUE AS inserted`,
        [
            event.eventKey,
            event.action,
            event.userId,
            JSON.stringify(event.payload),
            event.sourceIp ?? null
        ]
    );
    if (rows.length > 0) {
        return {inserted: true};
    }
    return {inserted: false};
}

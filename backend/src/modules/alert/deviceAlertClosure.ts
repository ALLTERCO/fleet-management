import {
    type AlertSeverity,
    publicAlertRuleKind,
    type StoredAlertRuleKind
} from '../../types/api/alert';
import * as AlertEvents from '../AlertEvents';
import * as postgres from '../PostgresProvider';

// One owner for "the device is gone, so its open alerts close". Rule deletion
// closes its own the same way, through the same resolver.

/** Stable reason written on the closing transition. */
export const DEVICE_DELETED_RESOLVE_MODE = 'device_deleted';

export interface ResolvedAlertRow {
    id: number;
    organization_id: string;
    rule_id: number;
    rule_kind: StoredAlertRuleKind;
    state: string;
    severity: AlertSeverity;
}

export async function resolveOpenAlertsForDeletedDevice(input: {
    organizationId: string;
    deviceId: number;
    actorUserId: string | null;
    actorDisplayName: string | null;
    txId?: number;
}): Promise<ResolvedAlertRow[]> {
    const result = await postgres.callMethod(
        'notifications.fn_alert_resolve_open_instances',
        {
            p_organization_id: input.organizationId,
            p_rule_id: null,
            p_device_id: input.deviceId,
            p_mode: DEVICE_DELETED_RESOLVE_MODE,
            p_actor_user_id: input.actorUserId,
            p_actor_display_name: input.actorDisplayName
        },
        input.txId
    );
    return (result?.rows ?? []) as ResolvedAlertRow[];
}

export function emitResolvedAlerts(rows: readonly ResolvedAlertRow[]): void {
    for (const row of rows) {
        AlertEvents.emitAlertResolved({
            organizationId: row.organization_id,
            alertId: row.id,
            ruleId: row.rule_id,
            ruleKind: publicAlertRuleKind(row.rule_kind),
            state: row.state,
            severity: row.severity
        });
    }
}

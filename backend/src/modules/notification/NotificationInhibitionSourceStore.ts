import type {DeliveryGroupingRule} from '../delivery/grouping';
import * as PostgresProvider from '../PostgresProvider';
import type {AlertPayloadRow} from './AlertPayloadBuilder';
import {readStringArray} from './rowReaders';

export interface InhibitionSourceAlert {
    rule: DeliveryGroupingRule;
    alert: AlertPayloadRow;
}

interface InhibitionSourceRow {
    id: number | string;
    organization_id: string;
    rule_id: number | string;
    rule_name: string;
    rule_kind: string;
    state: string;
    severity: 'info' | 'warning' | 'critical';
    source_subject_type: string;
    source_subject_id: string;
    title: string;
    message: string;
    active_since: Date | string;
    last_triggered_at: Date | string;
    group_by: unknown;
}

export async function listActiveInhibitionSourceAlerts(input: {
    organizationId: string;
}): Promise<InhibitionSourceAlert[]> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_alert_instance_list_active_for_inhibition',
        {p_organization_id: input.organizationId}
    );
    return ((result?.rows ?? []) as InhibitionSourceRow[]).map(rowToSource);
}

function rowToSource(row: InhibitionSourceRow): InhibitionSourceAlert {
    const organizationId = row.organization_id;
    const ruleId = Number(row.rule_id);
    return {
        rule: {
            id: ruleId,
            organizationId,
            name: row.rule_name,
            kind: row.rule_kind,
            groupBy: readStringArray(row.group_by)
        },
        alert: {
            id: Number(row.id),
            organization_id: organizationId,
            rule_kind: row.rule_kind,
            state: row.state,
            severity: row.severity,
            source_subject_type: row.source_subject_type,
            source_subject_id: row.source_subject_id,
            title: row.title,
            message: row.message,
            active_since: toIso(row.active_since),
            last_triggered_at: toIso(row.last_triggered_at)
        }
    };
}

function toIso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : value;
}

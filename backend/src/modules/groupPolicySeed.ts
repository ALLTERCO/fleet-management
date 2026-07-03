/** Boot-time idempotent seed: copy env FM_GROUP_POLICY_* values into
 *  organization.group_type_policy via ON CONFLICT DO NOTHING. Admin edits
 *  are never overwritten — env is one-way seed + fallback only. */
import * as log4js from 'log4js';
import {groupPolicy} from '../config/groupPolicy';
import {GROUP_TYPES, type GroupType} from '../types/api/group';
import * as PostgresProvider from './PostgresProvider';
import {formatError} from './util/formatError';

const logger = log4js.getLogger('groupPolicySeed');

type FieldKey = 'severity_floor' | 'retention_days' | 'audit_retention_days';

interface SeedRow {
    group_type: GroupType;
    field_key: FieldKey;
    value: string;
}

function buildRows(): SeedRow[] {
    const p = groupPolicy();
    const rows: SeedRow[] = [];
    for (const t of GROUP_TYPES) {
        const floor = p.severityFloorByType[t];
        if (floor)
            rows.push({
                group_type: t,
                field_key: 'severity_floor',
                value: floor
            });
        const ret = p.retentionDaysByType[t];
        if (ret != null)
            rows.push({
                group_type: t,
                field_key: 'retention_days',
                value: String(ret)
            });
        const aud = p.auditRetentionDaysByType[t];
        if (aud != null)
            rows.push({
                group_type: t,
                field_key: 'audit_retention_days',
                value: String(aud)
            });
    }
    return rows;
}

/** Call once after initDatabase. Safe to call again — ON CONFLICT noop. */
export async function seedPolicyDefaults(): Promise<void> {
    const rows = buildRows();
    if (rows.length === 0) {
        logger.debug('no env policy values to seed');
        return;
    }
    try {
        const res = await PostgresProvider.callMethod(
            'organization.fn_policy_seed_upsert',
            {p_rows: JSON.stringify(rows)}
        );
        const inserted = res?.rows?.length ?? 0;
        logger.info(
            'policy seed: %d env value(s) written (existing rows untouched)',
            inserted
        );
    } catch (err) {
        logger.error('policy seed failed: %s', formatError(err));
    }
}

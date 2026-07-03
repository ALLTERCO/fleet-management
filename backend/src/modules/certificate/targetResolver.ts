// Expand a push target into shellyIDs scoped to the tenant.

import type {CertificatePushTargetSummary} from '../../types/api/certificate';
import * as store from '../PostgresProvider';

export async function resolvePushTargetDevices(
    tenantId: string,
    target: CertificatePushTargetSummary
): Promise<string[]> {
    const out = new Set<string>();
    if (target.deviceIds?.length) {
        const rows = (await store.queryRows(
            `SELECT external_id AS id
               FROM device.list
              WHERE organization_id = $1
                AND external_id = ANY($2::text[])`,
            [tenantId, target.deviceIds]
        )) as unknown as Array<{id: string}>;
        for (const r of rows) out.add(r.id);
    }
    if (target.groupIds?.length) {
        const rows = (await store.queryRows(
            `SELECT DISTINCT gm.subject_id AS id
               FROM organization.group_members gm
               JOIN device.list d
                 ON d.external_id = gm.subject_id
                AND d.organization_id = gm.organization_id
              WHERE gm.organization_id = $1
                AND gm.subject_type = 'device'
                AND gm.group_id = ANY($2::int[])`,
            [tenantId, target.groupIds]
        )) as unknown as Array<{id: string}>;
        for (const r of rows) out.add(r.id);
    }
    if (target.tagKeys?.length) {
        const rows = (await store.queryRows(
            `SELECT DISTINCT ta.subject_id AS id
               FROM organization.tag_assignments ta
               JOIN organization.tags t ON t.id = ta.tag_id
               JOIN device.list d
                 ON d.external_id = ta.subject_id
                AND d.organization_id = t.organization_id
              WHERE ta.subject_type = 'device'
                AND t.organization_id = $1
                AND t.key = ANY($2::text[])`,
            [tenantId, target.tagKeys]
        )) as unknown as Array<{id: string}>;
        for (const r of rows) out.add(r.id);
    }
    return Array.from(out);
}

import {queryRows} from '../../PostgresProvider';
import type {ResourceId, ResourceRef} from '../contracts';
import type {TypedResourceResolver} from './ResourceResolver';

// alert / notification / channel scope refs all live in the notifications
// schema and carry organization_id, so tenant membership is verified the same
// way for the three of them.
const TABLE_BY_TYPE: Record<string, string> = {
    alert: 'notifications.alert_rules',
    notification: 'notifications.destination_groups',
    integration: 'notifications.channels'
};

interface OrgRow {
    organization_id: string;
}

export class NotificationsResourceResolver implements TypedResourceResolver {
    supports(resourceType: string): boolean {
        return resourceType in TABLE_BY_TYPE;
    }

    async resolve(resource: ResourceRef): Promise<ResourceRef> {
        if (resource.orgId || resource.id === undefined) return resource;
        const orgId = await findOrgId(
            TABLE_BY_TYPE[resource.type],
            resource.id
        );
        return {...resource, orgId};
    }
}

// Scope values arrive as wire strings ("123"); anything that isn't a positive
// integer resolves to no org and fails the tenant check loudly.
async function findOrgId(
    table: string,
    id: ResourceId
): Promise<string | undefined> {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId < 1) return undefined;
    const rows = await queryRows<OrgRow>(
        `SELECT organization_id FROM ${table} WHERE id = $1 LIMIT 1`,
        [numericId]
    );
    return rows[0]?.organization_id;
}

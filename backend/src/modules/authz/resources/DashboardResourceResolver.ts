import {queryRows} from '../../PostgresProvider';
import type {ResourceId, ResourceRef} from '../contracts';
import type {TypedResourceResolver} from './ResourceResolver';

interface DashboardResourceRow {
    organization_id: string;
}

export class DashboardResourceResolver implements TypedResourceResolver {
    supports(resourceType: string): boolean {
        return resourceType === 'dashboard';
    }

    async resolve(resource: ResourceRef): Promise<ResourceRef> {
        if (resource.orgId || resource.id === undefined) return resource;
        const orgId = await findDashboardOrgId(resource.id);
        return {...resource, orgId};
    }
}

async function findDashboardOrgId(id: ResourceId): Promise<string | undefined> {
    if (typeof id !== 'number') return undefined;
    const rows = await queryRows<DashboardResourceRow>(
        'SELECT organization_id FROM ui.dashboard WHERE id = $1 LIMIT 1',
        [id]
    );
    return rows[0]?.organization_id;
}

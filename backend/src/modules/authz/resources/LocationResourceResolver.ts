import {queryRows} from '../../PostgresProvider';
import type {ResourceId, ResourceRef} from '../contracts';
import type {TypedResourceResolver} from './ResourceResolver';

interface LocationResourceRow {
    organization_id: string;
}

export class LocationResourceResolver implements TypedResourceResolver {
    supports(resourceType: string): boolean {
        return resourceType === 'location';
    }

    async resolve(resource: ResourceRef): Promise<ResourceRef> {
        if (resource.orgId || resource.id === undefined) return resource;
        const orgId = await findLocationOrgId(resource.id);
        return {...resource, orgId};
    }
}

async function findLocationOrgId(id: ResourceId): Promise<string | undefined> {
    if (typeof id !== 'number') return undefined;
    const rows = await queryRows<LocationResourceRow>(
        'SELECT organization_id FROM organization.locations WHERE id = $1 LIMIT 1',
        [id]
    );
    return rows[0]?.organization_id;
}

import {queryRows} from '../../PostgresProvider';
import type {ResourceId, ResourceRef} from '../contracts';
import type {TypedResourceResolver} from './ResourceResolver';

interface GroupResourceRow {
    organization_id: string;
}

export class GroupResourceResolver implements TypedResourceResolver {
    supports(resourceType: string): boolean {
        return resourceType === 'group' || resourceType === 'device_group';
    }

    async resolve(resource: ResourceRef): Promise<ResourceRef> {
        if (resource.orgId || resource.id === undefined) return resource;
        const orgId = await findGroupOrgId(resource.id);
        return {...resource, orgId};
    }
}

async function findGroupOrgId(id: ResourceId): Promise<string | undefined> {
    if (typeof id !== 'number') return undefined;
    const rows = await queryRows<GroupResourceRow>(
        'SELECT organization_id FROM organization.groups WHERE id = $1 LIMIT 1',
        [id]
    );
    return rows[0]?.organization_id;
}

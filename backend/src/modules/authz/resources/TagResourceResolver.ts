import {queryRows} from '../../PostgresProvider';
import type {ResourceId, ResourceRef} from '../contracts';
import type {TypedResourceResolver} from './ResourceResolver';

interface TagResourceRow {
    organization_id: string;
}

export class TagResourceResolver implements TypedResourceResolver {
    supports(resourceType: string): boolean {
        return resourceType === 'tag';
    }

    async resolve(resource: ResourceRef): Promise<ResourceRef> {
        if (resource.orgId || resource.id === undefined) return resource;
        const orgId = await findTagOrgId(resource.id);
        return {...resource, orgId};
    }
}

async function findTagOrgId(id: ResourceId): Promise<string | undefined> {
    if (typeof id !== 'string') return undefined;
    const rows = await queryRows<TagResourceRow>(
        'SELECT organization_id FROM organization.tags WHERE key = $1 LIMIT 1',
        [id]
    );
    return rows[0]?.organization_id;
}

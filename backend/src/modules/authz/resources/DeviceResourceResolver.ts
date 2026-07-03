import {getDeviceOrg} from '../../EventDistributor';
import {queryRows} from '../../PostgresProvider';
import type {ResourceRef} from '../contracts';
import type {TypedResourceResolver} from './ResourceResolver';

interface DeviceResourceRow {
    organization_id: string;
}

export class DeviceResourceResolver implements TypedResourceResolver {
    supports(resourceType: string): boolean {
        return resourceType === 'device';
    }

    async resolve(resource: ResourceRef): Promise<ResourceRef> {
        if (resource.orgId || typeof resource.id !== 'string') return resource;
        const memoryOrgId = getDeviceOrg(resource.id);
        if (memoryOrgId) return {...resource, orgId: memoryOrgId};
        const orgId = await findDeviceOrgId(resource.id);
        return {
            ...resource,
            orgId
        };
    }
}

async function findDeviceOrgId(id: string): Promise<string | undefined> {
    const rows = await queryRows<DeviceResourceRow>(
        'SELECT organization_id FROM device.list WHERE external_id = $1 LIMIT 1',
        [id]
    );
    return rows[0]?.organization_id;
}

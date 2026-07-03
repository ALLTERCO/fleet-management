import RpcError from '../../../rpc/RpcError';
import type {AssignmentScope} from '../../../types/api/assignment';
import type {ResourceRef} from '../contracts';
import {createDefaultResourceResolver} from './DefaultResourceResolver';
import type {ResourceResolver} from './ResourceResolver';

export const ORG_SCOPED_RESOURCE_TYPES = [
    'device',
    'dashboard',
    'location',
    'group',
    'device_group',
    'tag',
    'alert',
    'notification',
    'integration'
] as const;

export const NON_RESOURCE_SCOPE_FIELDS = ['all', 'actions'] as const;

export const RESOURCE_SCOPE_FIELDS = [
    {field: 'device_ids', type: 'device'},
    {field: 'location_ids', type: 'location'},
    {field: 'device_group_ids', type: 'device_group'},
    {field: 'device_tags', type: 'tag'},
    {field: 'dashboard_ids', type: 'dashboard'},
    {field: 'plugin_keys', type: 'plugin'},
    {field: 'waiting_room_ids', type: 'waiting_room'},
    {field: 'configuration_keys', type: 'configuration'},
    {field: 'report_ids', type: 'report'},
    {field: 'organization_ids', type: 'organization'},
    {field: 'alert_ids', type: 'alert'},
    {field: 'notification_ids', type: 'notification'},
    {field: 'integration_keys', type: 'integration'},
    {field: 'automation_ids', type: 'automation'}
] as const;

type ResourceScopeField = (typeof RESOURCE_SCOPE_FIELDS)[number];

const ORG_SCOPED_TYPES = new Set<string>(ORG_SCOPED_RESOURCE_TYPES);

export async function assertScopeRefsBelongToOrg(input: {
    orgId: string;
    scope: AssignmentScope;
    resourceResolver?: ResourceResolver;
}): Promise<void> {
    const resolver = input.resourceResolver ?? createDefaultResourceResolver();
    for (const resource of resourcesFromScope(input.scope)) {
        await assertResourceBelongsToOrg({
            orgId: input.orgId,
            resource,
            resourceResolver: resolver
        });
    }
}

export function resourcesFromScope(scope: AssignmentScope): ResourceRef[] {
    return RESOURCE_SCOPE_FIELDS.flatMap((field) =>
        resourcesForField(scope, field)
    );
}

async function assertResourceBelongsToOrg(input: {
    orgId: string;
    resource: ResourceRef;
    resourceResolver: ResourceResolver;
}): Promise<void> {
    const resolved = await input.resourceResolver.resolve(input.resource);
    if (!ORG_SCOPED_TYPES.has(input.resource.type)) return;
    if (resolved.orgId === input.orgId) return;
    throw RpcError.NotFound(
        `${resourceLabel(input.resource.type)} outside tenant scope`
    );
}

function resourcesForField(
    scope: AssignmentScope,
    field: ResourceScopeField
): ResourceRef[] {
    const values = scope[field.field] as Array<number | string> | undefined;
    return unique(values).map((id) => ({type: field.type, id}));
}

function unique<T>(values: T[] | undefined): T[] {
    return [...new Set(values ?? [])];
}

function resourceLabel(type: string): string {
    return type === 'device_group' ? 'group' : type;
}

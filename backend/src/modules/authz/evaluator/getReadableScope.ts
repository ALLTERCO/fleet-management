import type CommandSender from '../../../model/CommandSender';
import type {ComponentName} from '../../../model/permissions';
import {
    denyAllScope,
    idScope,
    type ResourceId,
    type ScopeFilter,
    unrestrictedScope
} from '../contracts';
import {
    componentForResourceType,
    resourceTypeForComponent
} from './AuthzEvaluator';

export function getReadableScope(
    sender: CommandSender | undefined,
    resourceType: string
): ScopeFilter {
    const component = componentForResourceType(resourceType);
    if (!sender || !component) {
        return denyAllScope(resourceType, 'No readable scope is available.');
    }
    return scopeFromAllowedIds(
        resourceType,
        sender.getAllowedIdsForComponent(component)
    );
}

export async function getReadableScopeAsync(
    sender: CommandSender | undefined,
    resourceType: string
): Promise<ScopeFilter> {
    const component = componentForResourceType(resourceType);
    if (!sender || !component) {
        return denyAllScope(resourceType, 'No readable scope is available.');
    }
    if (component === 'locations') {
        return scopeFromAllowedIds(
            resourceType,
            await sender.getAllowedLocationIds()
        );
    }
    return scopeFromAllowedIds(
        resourceType,
        sender.getAllowedIdsForComponent(component)
    );
}

export function scopeFilterToIds<T extends ResourceId>(
    filter: ScopeFilter
): T[] | null {
    if (filter.kind === 'unrestricted') return null;
    if (filter.kind === 'deny_all') return [];
    return (filter.ids ?? []) as T[];
}

function scopeFromAllowedIds(
    resourceType: string,
    ids: ResourceId[] | null
): ScopeFilter {
    if (ids === null) return unrestrictedScope(resourceType);
    if (ids.length === 0) {
        return denyAllScope(resourceType, 'No readable ids are allowed.');
    }
    return idScope(resourceType, ids);
}

export function getReadableComponentIds<T extends ResourceId>(
    sender: CommandSender,
    component: ComponentName
): T[] | null {
    const resourceType = resourceTypeForComponent(component);
    return scopeFilterToIds<T>(getReadableScope(sender, resourceType));
}

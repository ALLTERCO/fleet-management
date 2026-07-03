import type CommandSender from '../../../model/CommandSender';
import type {ComponentName} from '../../../model/permissions';
import {resourceTypeForComponent} from './AuthzEvaluator';
import {
    getReadableComponentIds,
    getReadableScopeAsync,
    scopeFilterToIds
} from './getReadableScope';

/**
 * SQL pushdown allowlists:
 *   null -> unrestricted
 *   []   -> deny all
 *   T[]  -> exact readable ids
 */
export interface ReadableResourceAllowlists {
    devices: string[] | null;
    locations: number[] | null;
    groups: number[] | null;
    tags: number[] | null;
}

export function readableComponentIds<T extends number | string = number>(
    sender: CommandSender,
    component: ComponentName
): T[] | null {
    return getReadableComponentIds<T>(sender, component);
}

export function readableResourceAllowlists(
    sender: CommandSender
): ReadableResourceAllowlists {
    return {
        devices: readableComponentIds<string>(sender, 'devices'),
        locations: readableComponentIds(sender, 'locations'),
        groups: readableComponentIds(sender, 'groups'),
        tags: readableComponentIds(sender, 'tags')
    };
}

export async function readableResourceAllowlistsAsync(
    sender: CommandSender
): Promise<ReadableResourceAllowlists> {
    return {
        devices: await sender.getAllowedDeviceIds(),
        locations: scopeFilterToIds<number>(
            await getReadableScopeAsync(
                sender,
                resourceTypeForComponent('locations')
            )
        ),
        groups: readableComponentIds(sender, 'groups'),
        tags: readableComponentIds(sender, 'tags')
    };
}

export function resolveReadableFilterIds<T extends number | string>(
    allowed: T[] | null,
    requested: T[] | undefined
): T[] | null | 'none' {
    const hasRequested = Array.isArray(requested) && requested.length > 0;
    if (allowed === null) return hasRequested ? requested : null;
    if (allowed.length === 0) return 'none';
    if (!hasRequested) return allowed;
    const allowedSet = new Set(allowed);
    const filtered = requested.filter((id) => allowedSet.has(id));
    return filtered.length === 0 ? 'none' : filtered;
}

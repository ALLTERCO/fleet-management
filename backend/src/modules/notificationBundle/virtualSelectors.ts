import type {ImportMappingResult} from '../virtualDeviceAlerts';
import type {BundleImportConflict} from './planImport';
import type {NotificationBundle} from './schema';

export interface VirtualBundleSelector {
    key: string;
    path: string;
    deviceExternalId: string;
    roleKey: string;
}

export function collectVirtualBundleSelectors(
    bundle: NotificationBundle
): VirtualBundleSelector[] {
    return readObjects(bundle.routingPolicies).flatMap((policy, policyIndex) =>
        collectPolicyVirtualSelectors(policy, policyIndex)
    );
}

export function virtualSelectorKey(input: {
    deviceExternalId: string;
    roleKey: string;
}): string {
    return `${input.deviceExternalId}#${input.roleKey}`;
}

export function virtualSelectorConflicts(
    selectors: VirtualBundleSelector[],
    mappings: Record<string, ImportMappingResult>
): BundleImportConflict[] {
    return selectors.flatMap((selector) => {
        const mapping = mappings[selector.key];
        if (!mapping || mapping.ok) return [];
        return [
            {
                path: selector.path,
                message:
                    mapping.conflict ??
                    'virtual device selector could not be mapped'
            }
        ];
    });
}

export function mapVirtualResourceSelectors(
    selectors: unknown[],
    mappings: Record<string, ImportMappingResult>
): unknown[] {
    return selectors.map((selector) =>
        mapVirtualResourceSelector(selector, mappings)
    );
}

function collectPolicyVirtualSelectors(
    policy: Record<string, unknown>,
    policyIndex: number
): VirtualBundleSelector[] {
    return readObjects(policy.resourceSelectors).flatMap(
        (selector, selectorIndex) => {
            const parsed = parseVirtualSelector(selector);
            if (!parsed) return [];
            return [
                {
                    ...parsed,
                    key: virtualSelectorKey(parsed),
                    path: `routingPolicies[${policyIndex}].resourceSelectors[${selectorIndex}]`
                }
            ];
        }
    );
}

function mapVirtualResourceSelector(
    selector: unknown,
    mappings: Record<string, ImportMappingResult>
): unknown {
    const parsed = parseVirtualSelector(selector);
    if (!parsed) return selector;
    const mapping = mappings[virtualSelectorKey(parsed)];
    if (!mapping?.ok || !mapping.mappedDeviceExternalId) return selector;
    return {
        ...readObject(selector),
        type: 'device',
        id: mapping.mappedDeviceExternalId,
        role: mapping.mappedRoleKey ?? parsed.roleKey
    };
}

function parseVirtualSelector(value: unknown): {
    deviceExternalId: string;
    roleKey: string;
} | null {
    const selector = readObject(value);
    const type = readString(selector.type ?? selector.resourceType);
    const id = readString(selector.id ?? selector.resourceId);
    const roleKey = readString(selector.role ?? selector.roleKey);
    if (type !== 'device' || !id || !roleKey) return null;
    return {deviceExternalId: id, roleKey};
}

function readObjects(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) return [];
    return value.filter(
        (entry): entry is Record<string, unknown> =>
            !!entry && typeof entry === 'object' && !Array.isArray(entry)
    );
}

function readObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

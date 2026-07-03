// Virtual-device role projection: surface each role as a top-level
// status key pointing at its source component.

export interface RoleProjectionBinding {
    roleKey: string;
    sourceExternalId: string;
    sourceComponentKey: string;
    mode: 'linked' | 'materialized' | 'derived' | 'live_only';
}

export interface SourceSnapshot {
    status: Record<string, unknown>;
}

export type SourceLookup = (
    sourceShellyId: string
) => SourceSnapshot | undefined;

export interface RoleProjectionInput {
    bindings: ReadonlyArray<RoleProjectionBinding>;
    lookup: SourceLookup;
}

// Missing source/component → null so UI shows "no data" instead of crashing.
export function projectBindingsIntoStatus(
    input: RoleProjectionInput
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const binding of input.bindings) {
        const snapshot = input.lookup(binding.sourceExternalId);
        const componentStatus = snapshot?.status[binding.sourceComponentKey];
        out[binding.roleKey] = componentStatus ?? null;
    }
    return out;
}

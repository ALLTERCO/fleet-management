// Pure BLU child promote/demote DECISION logic — no DB, no event bus, no
// higher-level module. Lives in the model leaf so the device layer can decide
// when to reconcile without importing the promotion runtime, which would form
// a `ShellyDevice -> BluetoothAutoPromoter` import cycle. The runtime registers
// its concrete actions through the port at the bottom of this file.

// A promotable child is a BTHome device or a BLU TRV. Its sub-components
// (bthomesensor:/bthomecontrol:) ride the parent and are never promoted alone.
const IDENTITY_PREFIXES = ['bthomedevice:', 'blutrv:'] as const;

export function isBluIdentityKey(key: unknown): key is string {
    return (
        typeof key === 'string' &&
        IDENTITY_PREFIXES.some((prefix) => key.startsWith(prefix))
    );
}

export function bluIdentityKeysOf(config: Record<string, unknown>): string[] {
    return Object.keys(config).filter(isBluIdentityKey);
}

// Signature of the gateway's BLU data. Changes on bind/unbind and when a child's
// model/components get enriched — the trigger to refresh a promoted device.
export function bluChildFingerprint(config: Record<string, unknown>): string {
    return Object.keys(config)
        .filter((key) => key.startsWith('bthome') || key.startsWith('blutrv'))
        .sort()
        .map((key) => {
            const cfg = (config[key] ?? {}) as {
                addr?: unknown;
                meta?: {modelId?: unknown; productName?: unknown};
            };
            const meta = cfg.meta ?? {};
            return `${key}=${cfg.addr ?? ''}/${meta.modelId ?? ''}/${meta.productName ?? ''}`;
        })
        .join('|');
}

export interface ChildReconcilePlan {
    changed: boolean;
    fingerprint: string;
    currentKeys: string[];
    removedKeys: string[];
}

// `changed` = BLU data differs since last persist. `removedKeys` = identity
// children unbound since last persist (to demote).
export function planChildReconcile(
    prev: {fingerprint: string; keys: Iterable<string>},
    config: Record<string, unknown>
): ChildReconcilePlan {
    const fingerprint = bluChildFingerprint(config);
    const currentKeys = bluIdentityKeysOf(config);
    const current = new Set(currentKeys);
    const removedKeys = [...new Set(prev.keys)].filter(
        (key) => !current.has(key)
    );
    return {
        changed: fingerprint !== prev.fingerprint,
        fingerprint,
        currentKeys,
        removedKeys
    };
}

export interface ChildReconcileActions {
    // Resolves true when the promote succeeded, false when it failed (so the
    // caller can keep the prior state and retry instead of losing the child).
    reconcile: (gatewayExternalId: string) => Promise<boolean>;
    demote: (gatewayExternalId: string, componentKey: string) => void;
}

// True when config exposes a bound BLU child not yet reconciled into a device —
// the device layer flushes its persist at once so the child promotes in ~1s.
export function hasUnpromotedBluChild(
    config: Record<string, unknown>,
    promotedKeys: readonly string[]
): boolean {
    return Object.keys(config).some(
        (key) => isBluIdentityKey(key) && !promotedKeys.includes(key)
    );
}

// Promote newly bound children and demote unbound ones when the BLU data
// changed. Returns the new (fingerprint, keys) to remember. The decision is
// synchronous; the promote/demote run in the background via `actions`, which
// the caller injects — the promotion runtime for production, mocks for tests.
export async function reconcileBluChildren(
    gatewayExternalId: string,
    config: Record<string, unknown>,
    prev: {fingerprint: string; keys: readonly string[]},
    actions: ChildReconcileActions,
    orgKnown = true
): Promise<{fingerprint: string; keys: string[]}> {
    const plan = planChildReconcile(prev, config);
    if (!plan.changed) {
        return {fingerprint: prev.fingerprint, keys: [...prev.keys]};
    }
    // Org not mapped yet: promote/demote would no-op. Keep the previous state
    // so the next persist retries once the device→org map catches up.
    if (!orgKnown) {
        return {fingerprint: prev.fingerprint, keys: [...prev.keys]};
    }
    if (plan.currentKeys.length > 0) {
        // Advance state only after the promote succeeds; on failure keep the
        // prior state so the next persist retries, or the child is lost until
        // the process restarts.
        if (!(await actions.reconcile(gatewayExternalId))) {
            return {fingerprint: prev.fingerprint, keys: [...prev.keys]};
        }
    }
    for (const key of plan.removedKeys) actions.demote(gatewayExternalId, key);
    return {fingerprint: plan.fingerprint, keys: plan.currentKeys};
}

// Runtime port. The promotion module (BluetoothAutoPromoter) registers its
// concrete background actions and org lookup at load; the device layer calls
// reconcileBluChildrenForDevice without importing that module.
export interface BluChildRuntime {
    actions: ChildReconcileActions;
    isOrgKnown: (shellyID: string) => boolean;
}

let activeRuntime: BluChildRuntime | undefined;

export function registerBluChildRuntime(runtime: BluChildRuntime): void {
    activeRuntime = runtime;
}

// Device-facing entry: reconcile using the registered runtime. Until the
// runtime is wired the previous state is kept, so the next persist retries —
// the same conservative behaviour used when a device's org is not yet mapped.
export async function reconcileBluChildrenForDevice(
    gatewayExternalId: string,
    config: Record<string, unknown>,
    prev: {fingerprint: string; keys: readonly string[]}
): Promise<{fingerprint: string; keys: string[]}> {
    if (!activeRuntime) {
        return {fingerprint: prev.fingerprint, keys: [...prev.keys]};
    }
    return reconcileBluChildren(
        gatewayExternalId,
        config,
        prev,
        activeRuntime.actions,
        activeRuntime.isOrgKnown(gatewayExternalId)
    );
}

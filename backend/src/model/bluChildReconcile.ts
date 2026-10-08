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

// Signature of the gateway's BLU data. Changes on bind/unbind, when a child's
// model/components get enriched, and when a child is renamed — the trigger to
// refresh a promoted device.
//
// `name` belongs here because a promoted device's display name is a snapshot
// taken from this config at promote time. Leaving it out meant a rename
// changed the gateway and nothing else: the fingerprint matched, reconcile was
// skipped, and the stored snapshot stayed stale forever. The name then updated
// on the devices grid (which reads the gateway) while the device page, search,
// groups and alert scopes (which read the snapshot) all kept the old one.
export function bluChildFingerprint(config: Record<string, unknown>): string {
    return Object.keys(config)
        .filter((key) => key.startsWith('bthome') || key.startsWith('blutrv'))
        .sort()
        .map((key) => {
            const cfg = (config[key] ?? {}) as {
                addr?: unknown;
                name?: unknown;
                meta?: {modelId?: unknown; productName?: unknown};
            };
            const meta = cfg.meta ?? {};
            return `${key}=${cfg.addr ?? ''}/${cfg.name ?? ''}/${meta.modelId ?? ''}/${meta.productName ?? ''}`;
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

export interface BluChildReconcileState {
    fingerprint: string;
    keys: string[];
}

export type BluChildReconcileRunner = (
    gatewayExternalId: string,
    config: Record<string, unknown>,
    state: BluChildReconcileState
) => Promise<BluChildReconcileState>;

export interface BluChildReconcileSchedule {
    scheduled: boolean;
    coalesced: boolean;
    completion: Promise<void>;
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
    prev: BluChildReconcileState
): Promise<BluChildReconcileState> {
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

// One authoritative reconcile state per gateway. Persists can finish while a
// reconcile is still running; retain only the latest config and process it
// after the current run so repeated snapshots do not fan out into duplicate
// database work and a newer bind/unbind is never lost.
export class BluChildReconcileCoordinator {
    readonly #gatewayExternalId: string;
    readonly #reconcile: BluChildReconcileRunner;
    #state: BluChildReconcileState = {fingerprint: '', keys: []};
    #pendingConfig: Record<string, unknown> | undefined;
    #pendingFingerprint: string | undefined;
    #activeFingerprint: string | undefined;
    #inflight: Promise<void> | undefined;

    constructor(input: {
        gatewayExternalId: string;
        reconcile?: BluChildReconcileRunner;
    }) {
        this.#gatewayExternalId = input.gatewayExternalId;
        this.#reconcile = input.reconcile ?? reconcileBluChildrenForDevice;
    }

    hasUnpromotedChild(config: Record<string, unknown>): boolean {
        return hasUnpromotedBluChild(config, this.#state.keys);
    }

    schedule(config: Record<string, unknown>): BluChildReconcileSchedule {
        const fingerprint = bluChildFingerprint(config);
        if (
            (!this.#inflight && fingerprint === this.#state.fingerprint) ||
            fingerprint === this.#activeFingerprint ||
            fingerprint === this.#pendingFingerprint
        ) {
            return {
                scheduled: false,
                coalesced: this.#inflight !== undefined,
                completion: this.#inflight ?? Promise.resolve()
            };
        }
        this.#pendingConfig = config;
        this.#pendingFingerprint = fingerprint;
        if (this.#inflight) {
            return {
                scheduled: true,
                coalesced: true,
                completion: this.#inflight
            };
        }
        this.#inflight = this.#drain().finally(() => {
            this.#inflight = undefined;
        });
        return {
            scheduled: true,
            coalesced: false,
            completion: this.#inflight
        };
    }

    state(): BluChildReconcileState {
        return {
            fingerprint: this.#state.fingerprint,
            keys: [...this.#state.keys]
        };
    }

    async #drain(): Promise<void> {
        while (this.#pendingConfig) {
            const config = this.#pendingConfig;
            this.#pendingConfig = undefined;
            this.#activeFingerprint = this.#pendingFingerprint;
            this.#pendingFingerprint = undefined;
            this.#state = await this.#reconcile(
                this.#gatewayExternalId,
                config,
                this.#state
            );
            this.#activeFingerprint = undefined;
        }
    }
}

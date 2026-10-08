import * as log4js from 'log4js';
import {tuning} from '../config/tuning';
import {
    type ChildReconcileActions,
    registerBluChildRuntime
} from '../model/bluChildReconcile';
import {
    ingressBluDemoted,
    ingressBluPromoted,
    ingressDropped,
    ingressStage
} from './deviceIngress/ingressTrace';
import type {DeviceInventorySource} from './EventDistributor';
import * as EventDistributor from './EventDistributor';
import * as Observability from './Observability';
import {
    recordBluReconcileCapacity,
    recordBluReconcileCapacityRejection,
    recordBluReconcileRun
} from './observability/bluReconcileTimings';
import {runVirtualDeviceMutation} from './virtualDevice/accessInvalidation';
import {
    deleteBluetoothDeviceWithOutcome,
    getBluetoothDeviceExternalIdBySource,
    listBluetoothCandidates,
    promoteBluetoothFromGatewayWithOutcome,
    promoteBluetoothGatewayChildrenWithOutcome
} from './virtualDevice/bluetoothRepository';
import {BluReconcileConcurrency} from './virtualDevice/bluReconcileConcurrency';

// Pure BLU decision helpers now live in the model leaf (model/bluChildReconcile)
// to break the ShellyDevice → promoter import cycle. Re-exported here so existing
// importers and unit tests keep resolving them from this module.
export {
    bluChildFingerprint,
    bluIdentityKeysOf,
    type ChildReconcilePlan,
    hasUnpromotedBluChild,
    isBluIdentityKey,
    planChildReconcile,
    reconcileBluChildren
} from '../model/bluChildReconcile';
export type {ChildReconcileActions};

const logger = log4js.getLogger('BluetoothAutoPromoter');

const BT_SOURCE: DeviceInventorySource = 'bluetooth';

const reconcileCapacity = new BluReconcileConcurrency(
    tuning.virtualDevice.bluReconcileConcurrency,
    tuning.virtualDevice.bluReconcileQueueMax,
    ({active, queued}) => recordBluReconcileCapacity(active, queued),
    recordBluReconcileCapacityRejection
);

interface PromotionOutcome {
    externalId: string;
    created: boolean;
    changed: boolean;
    /** Other gateways whose cached status routes this change made wrong. */
    staleRouteGatewayExternalIds?: readonly string[];
}

interface RemovalOutcome {
    /** Gateways whose cached status routes still list the removed device. */
    staleRouteGatewayExternalIds: readonly string[];
}

// Seam so the promote/demote decisions are unit-testable without a DB or the
// event bus. Production values wire the real repository + EventDistributor.
export interface AutoPromoteDeps {
    getDeviceOrg: (shellyID: string) => string | undefined;
    listCandidates: (
        orgId: string,
        gatewayExternalId: string
    ) => Promise<{
        items: ReadonlyArray<{componentKey: string; alreadyPromoted: boolean}>;
    }>;
    promote: (
        orgId: string,
        gatewayExternalId: string,
        componentKey: string,
        makePrimary: boolean
    ) => Promise<PromotionOutcome>;
    promoteBatch?: (
        orgId: string,
        gatewayExternalId: string,
        componentKeys: readonly string[]
    ) => Promise<Array<PromotionOutcome & {componentKey: string}>>;
    resolveExternalId: (
        orgId: string,
        gatewayExternalId: string,
        componentKey: string
    ) => Promise<string | null>;
    remove: (
        orgId: string,
        externalId: string
    ) => Promise<RemovalOutcome | undefined>;
    emitCreated: (
        externalId: string,
        orgId: string,
        gatewayExternalId: string
    ) => void;
    emitUpdated: (
        externalId: string,
        orgId: string,
        gatewayExternalId: string,
        staleRouteGatewayExternalIds?: readonly string[]
    ) => void;
    emitDeleted: (
        externalId: string,
        orgId: string,
        gatewayExternalId: string,
        staleRouteGatewayExternalIds?: readonly string[]
    ) => void;
}

interface GatewayPassOutcome {
    componentKey: string;
    device: {externalId: string};
    created: boolean;
    changed: boolean;
    staleRouteGatewayExternalIds?: readonly string[];
}

export interface GatewayPassPorts {
    promote: (
        orgId: string,
        gatewayExternalId: string,
        componentKeys: readonly string[]
    ) => Promise<GatewayPassOutcome[]>;
    invalidateAccess: (orgId: string, externalIds: readonly string[]) => void;
}

const defaultPassPorts: GatewayPassPorts = {
    promote: promoteBluetoothGatewayChildrenWithOutcome,
    invalidateAccess: (orgId, externalIds) =>
        EventDistributor.invalidateOrganizationInventory({orgId, externalIds})
};

// A pass writes BLU devices and transports, never grants or virtual bindings,
// so only membership-keyed caches move, and only when a row changed.
export async function promoteGatewayPass(
    input: {
        orgId: string;
        gatewayExternalId: string;
        componentKeys: readonly string[];
    },
    overrides: Partial<GatewayPassPorts> = {}
): Promise<Array<PromotionOutcome & {componentKey: string}>> {
    const ports = {...defaultPassPorts, ...overrides};
    const outcomes = await ports.promote(
        input.orgId,
        input.gatewayExternalId,
        input.componentKeys
    );
    const changed = outcomes
        .filter((outcome) => outcome.created || outcome.changed)
        .map((outcome) => outcome.device.externalId);
    if (changed.length > 0) ports.invalidateAccess(input.orgId, changed);
    return outcomes.map((outcome) => ({
        componentKey: outcome.componentKey,
        externalId: outcome.device.externalId,
        created: outcome.created,
        changed: outcome.changed,
        staleRouteGatewayExternalIds: outcome.staleRouteGatewayExternalIds
    }));
}

const defaultDeps: AutoPromoteDeps = {
    getDeviceOrg: EventDistributor.getDeviceOrg,
    listCandidates: (orgId, gatewayExternalId) =>
        listBluetoothCandidates(orgId, {gatewayExternalId}),
    promote: (orgId, gatewayExternalId, componentKey, makePrimary) =>
        runVirtualDeviceMutation(orgId, async () => {
            const outcome = await promoteBluetoothFromGatewayWithOutcome(
                orgId,
                {
                    gatewayExternalId,
                    componentKey,
                    makePrimary
                }
            );
            return {
                externalId: outcome.device.externalId,
                created: outcome.created,
                changed: outcome.changed,
                staleRouteGatewayExternalIds:
                    outcome.staleRouteGatewayExternalIds
            };
        }),
    promoteBatch: (orgId, gatewayExternalId, componentKeys) =>
        promoteGatewayPass({orgId, gatewayExternalId, componentKeys}),
    resolveExternalId: getBluetoothDeviceExternalIdBySource,
    remove: async (orgId, externalId) => {
        // A tombstone keeps the device row and its bindings; only membership moves.
        const removed = await deleteBluetoothDeviceWithOutcome(orgId, {
            externalId,
            retention: 'tombstone'
        });
        EventDistributor.invalidateOrganizationInventory({
            orgId,
            externalIds: [externalId]
        });
        return removed;
    },
    emitCreated: (externalId, orgId, gatewayExternalId) =>
        EventDistributor.emitDeviceCreated({
            externalId,
            source: BT_SOURCE,
            orgId,
            gatewayExternalId
        }),
    emitUpdated: (
        externalId,
        orgId,
        gatewayExternalId,
        staleRouteGatewayExternalIds
    ) =>
        EventDistributor.emitDeviceUpdated({
            externalId,
            source: BT_SOURCE,
            orgId,
            gatewayExternalId,
            staleRouteGatewayExternalIds
        }),
    emitDeleted: (
        externalId,
        orgId,
        gatewayExternalId,
        staleRouteGatewayExternalIds
    ) =>
        EventDistributor.emitDeviceDeleted({
            externalId,
            source: BT_SOURCE,
            orgId,
            gatewayExternalId,
            staleRouteGatewayExternalIds
        })
};

// Promote every bound child of a gateway that is not already a device.
// Idempotent: a re-run promotes nothing new. No-op if the org is not mapped
// yet (a later persist retries once the device-org map catches up). Reads the
// gateway's children from the DB, so the caller must persist config first.
export async function reconcileGatewayChildren(
    gatewayExternalId: string,
    deps: AutoPromoteDeps = defaultDeps
): Promise<void> {
    const orgId = deps.getDeviceOrg(gatewayExternalId);
    if (!orgId) return;
    const {items} = await deps.listCandidates(orgId, gatewayExternalId);
    const outcomes = deps.promoteBatch
        ? await deps.promoteBatch(
              orgId,
              gatewayExternalId,
              items.map((child) => child.componentKey)
          )
        : await Promise.all(
              items.map(async (child) => ({
                  componentKey: child.componentKey,
                  ...(await deps.promote(
                      orgId,
                      gatewayExternalId,
                      child.componentKey,
                      false
                  ))
              }))
          );
    EventDistributor.batchBluetoothInventoryChanges(() => {
        for (const outcome of outcomes) {
            announcePromotionOutcome(outcome, {orgId, gatewayExternalId}, deps);
        }
    });
}

function announcePromotionOutcome(
    outcome: PromotionOutcome & {componentKey: string},
    gateway: {orgId: string; gatewayExternalId: string},
    deps: AutoPromoteDeps
): void {
    const {orgId, gatewayExternalId} = gateway;
    try {
        const {externalId, created, changed, componentKey} = outcome;
        const via = `${componentKey}@${gatewayExternalId}`;
        if (created) {
            deps.emitCreated(externalId, orgId, gatewayExternalId);
            ingressBluPromoted(externalId, via);
        } else if (changed) {
            deps.emitUpdated(
                externalId,
                orgId,
                gatewayExternalId,
                outcome.staleRouteGatewayExternalIds
            );
            ingressStage(externalId, 'blu-refreshed', via);
        } else {
            Observability.incrementCounter('blu_promotion_noop_total');
        }
    } catch (err) {
        ingressDropped(outcome.componentKey, 'blu_promote_failed');
        logger.warn(
            'auto-promote failed gateway=%s child=%s: %s',
            gatewayExternalId,
            outcome.componentKey,
            err
        );
    }
}

// Remove the promoted device for a child that was unbound from its gateway.
// No-op if the child was never promoted.
export async function demoteRemovedChild(
    gatewayExternalId: string,
    componentKey: string,
    deps: AutoPromoteDeps = defaultDeps
): Promise<void> {
    const orgId = deps.getDeviceOrg(gatewayExternalId);
    if (!orgId) return;
    const externalId = await deps.resolveExternalId(
        orgId,
        gatewayExternalId,
        componentKey
    );
    if (!externalId) return;
    const removed = await deps.remove(orgId, externalId);
    deps.emitDeleted(
        externalId,
        orgId,
        gatewayExternalId,
        removed?.staleRouteGatewayExternalIds
    );
    ingressBluDemoted(externalId, `${componentKey}@${gatewayExternalId}`);
}

// Demote every promoted child of a gateway. Called before a gateway device is
// deleted, so its BLU children don't linger as orphaned "online" ghosts.
export async function demoteAllChildren(
    gatewayExternalId: string,
    deps: AutoPromoteDeps = defaultDeps
): Promise<void> {
    const orgId = deps.getDeviceOrg(gatewayExternalId);
    if (!orgId) return;
    const {items} = await deps.listCandidates(orgId, gatewayExternalId);
    for (const child of items) {
        if (!child.alreadyPromoted) continue;
        try {
            await demoteRemovedChild(
                gatewayExternalId,
                child.componentKey,
                deps
            );
        } catch (err) {
            logger.warn(
                'auto-demote-all failed gateway=%s child=%s: %s',
                gatewayExternalId,
                child.componentKey,
                err
            );
        }
    }
}

// Is this device's org mapped yet? Promotion no-ops without it, so the device
// layer uses this to avoid recording an un-done reconcile as done.
export function isDeviceOrgKnown(shellyID: string): boolean {
    return EventDistributor.getDeviceOrg(shellyID) != null;
}

// Production actions: promote/demote run in the background so persistence is
// never blocked; failures are logged, not thrown.
const backgroundActions: ChildReconcileActions = {
    reconcile: (gatewayExternalId) =>
        reconcileCapacity.run(() =>
            reconcileGatewayChildrenSafe(gatewayExternalId)
        ),
    demote: (gatewayExternalId, componentKey) =>
        void demoteRemovedChild(gatewayExternalId, componentKey).catch((err) =>
            logger.warn(
                'BLU auto-demote failed for %s %s: %s',
                gatewayExternalId,
                componentKey,
                err
            )
        )
};

async function reconcileGatewayChildrenSafe(
    gatewayExternalId: string
): Promise<boolean> {
    const startedAt = Date.now();
    try {
        await reconcileGatewayChildren(gatewayExternalId);
        recordBluReconcileRun('succeeded', Date.now() - startedAt);
        return true;
    } catch (err) {
        recordBluReconcileRun('failed', Date.now() - startedAt);
        // Keep the prior state so the next persist retries instead of losing
        // the child when a gateway-level read fails.
        logger.warn(
            'BLU auto-promote failed for %s: %s',
            gatewayExternalId,
            err
        );
        return false;
    }
}

// Wire the promotion runtime into the device layer's port. DeviceComponent
// imports this module at startup (demoteAllChildren), so the runtime is
// registered before any device persists and triggers a reconcile.
registerBluChildRuntime({
    actions: backgroundActions,
    isOrgKnown: isDeviceOrgKnown
});

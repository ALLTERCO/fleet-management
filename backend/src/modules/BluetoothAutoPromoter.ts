import * as log4js from 'log4js';
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
import {runVirtualDeviceMutation} from './virtualDevice/accessInvalidation';
import {
    deleteBluetoothDevice,
    getBluetoothDeviceExternalIdBySource,
    listBluetoothCandidates,
    promoteBluetoothFromGateway
} from './virtualDevice/bluetoothRepository';

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
    ) => Promise<{externalId: string}>;
    resolveExternalId: (
        orgId: string,
        gatewayExternalId: string,
        componentKey: string
    ) => Promise<string | null>;
    remove: (orgId: string, externalId: string) => Promise<unknown>;
    emitCreated: (externalId: string, orgId: string) => void;
    emitUpdated: (externalId: string, orgId: string) => void;
    emitDeleted: (externalId: string, orgId: string) => void;
}

const defaultDeps: AutoPromoteDeps = {
    getDeviceOrg: EventDistributor.getDeviceOrg,
    listCandidates: (orgId, gatewayExternalId) =>
        listBluetoothCandidates(orgId, {gatewayExternalId}),
    promote: (orgId, gatewayExternalId, componentKey, makePrimary) =>
        runVirtualDeviceMutation(orgId, () =>
            promoteBluetoothFromGateway(orgId, {
                gatewayExternalId,
                componentKey,
                makePrimary
            })
        ),
    resolveExternalId: getBluetoothDeviceExternalIdBySource,
    remove: (orgId, externalId) =>
        runVirtualDeviceMutation(orgId, () =>
            deleteBluetoothDevice(orgId, {externalId, retention: 'tombstone'})
        ),
    emitCreated: (externalId, orgId) =>
        EventDistributor.emitDeviceCreated({
            externalId,
            source: BT_SOURCE,
            orgId
        }),
    emitUpdated: (externalId, orgId) =>
        EventDistributor.emitDeviceUpdated({
            externalId,
            source: BT_SOURCE,
            orgId
        }),
    emitDeleted: (externalId, orgId) =>
        EventDistributor.emitDeviceDeleted({
            externalId,
            source: BT_SOURCE,
            orgId
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
    for (const child of items) {
        try {
            // Upsert also refreshes an existing device's model/components. A new
            // child becomes primary; an existing one is refreshed WITHOUT
            // stealing primary, so two gateways don't ping-pong it.
            const {externalId} = await deps.promote(
                orgId,
                gatewayExternalId,
                child.componentKey,
                !child.alreadyPromoted
            );
            const via = `${child.componentKey}@${gatewayExternalId}`;
            if (child.alreadyPromoted) {
                deps.emitUpdated(externalId, orgId);
                ingressStage(externalId, 'blu-refreshed', via);
            } else {
                deps.emitCreated(externalId, orgId);
                ingressBluPromoted(externalId, via);
            }
        } catch (err) {
            // One bad child must not block its siblings.
            ingressDropped(child.componentKey, 'blu_promote_failed');
            logger.warn(
                'auto-promote failed gateway=%s child=%s: %s',
                gatewayExternalId,
                child.componentKey,
                err
            );
        }
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
    await deps.remove(orgId, externalId);
    deps.emitDeleted(externalId, orgId);
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
        reconcileGatewayChildren(gatewayExternalId).then(
            () => true,
            (err) => {
                // Report the failure so the device keeps its prior state and
                // retries on the next persist instead of losing the child.
                logger.warn(
                    'BLU auto-promote failed for %s: %s',
                    gatewayExternalId,
                    err
                );
                return false;
            }
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

// Wire the promotion runtime into the device layer's port. DeviceComponent
// imports this module at startup (demoteAllChildren), so the runtime is
// registered before any device persists and triggers a reconcile.
registerBluChildRuntime({
    actions: backgroundActions,
    isOrgKnown: isDeviceOrgKnown
});

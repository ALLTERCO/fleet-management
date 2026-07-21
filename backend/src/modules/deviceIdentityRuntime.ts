import {randomUUID} from 'node:crypto';
import {flush as flushAuditLog} from './AuditLogger';
import {disconnectForIdentityChange} from './DeviceCollector';
import {flush as flushDeviceEvents} from './DeviceEventLogger';
import * as Observability from './Observability';
import {getInstanceId} from './redis/instanceId';
import type {DeviceSignal} from './redis/ports';
import {
    deviceIdentityFence,
    deviceOwnership,
    deviceSignals,
    kv
} from './redis/services';
import {flushBeforeDeviceIdentityChange as flushTelemetry} from './ShellyMessageHandler';

const ACK_TTL_SEC = 30;
const ACK_TIMEOUT_MS = 5_000;
const ACK_POLL_MS = 25;
const OWNERSHIP_TTL_MS = 30_000;
const OWNERSHIP_HEARTBEAT_MS = 10_000;
const IDENTITY_FENCE_TTL_MS = 5 * 60_000;

const ownedDeviceIds = new Set<string>();
let ownershipHeartbeat: ReturnType<typeof setInterval> | null = null;

interface OwnershipDeps {
    claim(shellyID: string, ttlMs: number): Promise<boolean>;
    heartbeat(shellyID: string, ttlMs: number): Promise<boolean>;
    release(shellyID: string): Promise<void>;
    disconnect(shellyIDs: readonly string[]): void;
}

const ownershipDeps: OwnershipDeps = {
    claim: (shellyID, ttlMs) => deviceOwnership.claim(shellyID, ttlMs),
    heartbeat: (shellyID, ttlMs) => deviceOwnership.heartbeat(shellyID, ttlMs),
    release: (shellyID) => deviceOwnership.release(shellyID),
    disconnect: disconnectForIdentityChange
};

export async function claimDeviceRuntimeOwnership(
    shellyID: string,
    overrides: Partial<OwnershipDeps> = {}
): Promise<boolean> {
    const deps = {...ownershipDeps, ...overrides};
    const claimed = await deps.claim(shellyID, OWNERSHIP_TTL_MS);
    if (!claimed) {
        Observability.incrementCounter('device_ownership_claim_rejected_total');
        return false;
    }
    ownedDeviceIds.add(shellyID);
    Observability.setGauge('device_ownership_leases', ownedDeviceIds.size);
    return true;
}

export async function releaseDeviceRuntimeOwnership(
    shellyID: string,
    overrides: Partial<OwnershipDeps> = {}
): Promise<void> {
    if (!ownedDeviceIds.delete(shellyID)) return;
    Observability.setGauge('device_ownership_leases', ownedDeviceIds.size);
    await (overrides.release ?? ownershipDeps.release)(shellyID);
}

export async function heartbeatDeviceRuntimeOwnership(
    overrides: Partial<OwnershipDeps> = {}
): Promise<void> {
    const deps = {...ownershipDeps, ...overrides};
    for (const shellyID of [...ownedDeviceIds]) {
        if (await deps.heartbeat(shellyID, OWNERSHIP_TTL_MS)) continue;
        ownedDeviceIds.delete(shellyID);
        deps.disconnect([shellyID]);
        Observability.incrementCounter('device_ownership_lost_total');
    }
    Observability.setGauge('device_ownership_leases', ownedDeviceIds.size);
}

export function startDeviceOwnershipHeartbeat(): void {
    if (ownershipHeartbeat) return;
    ownershipHeartbeat = setInterval(
        () => void heartbeatDeviceRuntimeOwnership(),
        OWNERSHIP_HEARTBEAT_MS
    );
    ownershipHeartbeat.unref?.();
}

export async function stopDeviceOwnershipHeartbeat(): Promise<void> {
    if (ownershipHeartbeat) clearInterval(ownershipHeartbeat);
    ownershipHeartbeat = null;
    const ids = [...ownedDeviceIds];
    await Promise.all(ids.map((id) => releaseDeviceRuntimeOwnership(id)));
}

interface IdentityFenceDeps {
    acquire(
        shellyIDs: readonly string[],
        token: string,
        ttlMs: number
    ): Promise<boolean>;
    release(shellyIDs: readonly string[], token: string): Promise<void>;
    prepare(oldShellyID: string, newShellyID: string): Promise<void>;
    operationId(): string;
}

export async function withDeviceIdentityChange<T>(
    oldShellyID: string,
    newShellyID: string,
    operation: () => Promise<T>,
    overrides: Partial<IdentityFenceDeps> = {}
): Promise<T> {
    const ids = [oldShellyID, newShellyID];
    const token = (overrides.operationId ?? randomUUID)();
    const acquire = overrides.acquire ?? deviceIdentityFence.acquire;
    const release = overrides.release ?? deviceIdentityFence.release;
    const prepared = await acquire(ids, token, IDENTITY_FENCE_TTL_MS);
    if (!prepared) {
        throw new Error('device identity is already changing');
    }
    try {
        await (overrides.prepare ?? prepareDeviceIdentityChange)(
            oldShellyID,
            newShellyID
        );
        return await operation();
    } finally {
        await release(ids, token);
    }
}

interface IdentityFlushDeps {
    telemetry(): Promise<void>;
    events(): Promise<void>;
    audit(): Promise<void>;
}

export async function flushDeviceIdentityBuffers(
    overrides: Partial<IdentityFlushDeps> = {}
): Promise<void> {
    const deps: IdentityFlushDeps = {
        telemetry: flushTelemetry,
        events: flushDeviceEvents,
        audit: flushAuditLog,
        ...overrides
    };
    await deps.telemetry();
    await deps.events();
    await deps.audit();
}

interface IdentityRuntimeDeps {
    disconnect(shellyIDs: readonly string[]): void;
    flush(): Promise<void>;
    publish(input: {
        kind: 'identity-changing';
        shellyID: string;
        previousShellyID: string;
        operationId: string;
    }): Promise<void>;
    owner(shellyID: string): Promise<string | null>;
    instanceId(): string;
    readAck(key: string): Promise<string | null>;
    writeAck(key: string, ttlSec: number): Promise<void>;
    sleep(ms: number): Promise<void>;
    operationId(): string;
    now(): number;
}

const defaultDeps: IdentityRuntimeDeps = {
    disconnect: disconnectForIdentityChange,
    flush: flushDeviceIdentityBuffers,
    publish: (input) => deviceSignals.publish(input),
    owner: (shellyID) => deviceOwnership.owner(shellyID),
    instanceId: getInstanceId,
    readAck: (key) => kv.get(key),
    writeAck: (key, ttlSec) => kv.set(key, '1', ttlSec),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    operationId: randomUUID,
    now: Date.now
};

function runtimeDeps(
    overrides: Partial<IdentityRuntimeDeps>
): IdentityRuntimeDeps {
    return {...defaultDeps, ...overrides};
}

function ackKey(operationId: string, instanceId: string): string {
    return `device-identity-change:${operationId}:ack:${instanceId}`;
}

export async function handleIdentityChangingSignal(
    oldShellyID: string,
    newShellyID: string,
    overrides: Partial<IdentityRuntimeDeps> = {}
): Promise<void> {
    const deps = runtimeDeps(overrides);
    deps.disconnect([oldShellyID, newShellyID]);
    await Promise.all([
        releaseDeviceRuntimeOwnership(oldShellyID),
        releaseDeviceRuntimeOwnership(newShellyID)
    ]);
    await deps.flush();
}

export async function handlePeerIdentityChangingSignal(
    signal: DeviceSignal,
    overrides: Partial<IdentityRuntimeDeps> = {}
): Promise<void> {
    if (
        signal.kind !== 'identity-changing' ||
        !signal.previousShellyID ||
        !signal.operationId
    ) {
        return;
    }
    const deps = runtimeDeps(overrides);
    await handleIdentityChangingSignal(
        signal.previousShellyID,
        signal.shellyID,
        deps
    );
    await deps.writeAck(
        ackKey(signal.operationId, deps.instanceId()),
        ACK_TTL_SEC
    );
}

export async function prepareDeviceIdentityChange(
    oldShellyID: string,
    newShellyID: string,
    overrides: Partial<IdentityRuntimeDeps> = {}
): Promise<void> {
    const deps = runtimeDeps(overrides);
    const operationId = deps.operationId();
    const owners = new Set(
        (
            await Promise.all([
                deps.owner(oldShellyID),
                deps.owner(newShellyID)
            ])
        ).filter((owner): owner is string => Boolean(owner))
    );
    owners.delete(deps.instanceId());

    await deps.publish({
        kind: 'identity-changing',
        shellyID: newShellyID,
        previousShellyID: oldShellyID,
        operationId
    });
    await handleIdentityChangingSignal(oldShellyID, newShellyID, deps);
    await waitForOwnerAcks(operationId, owners, deps);
}

async function waitForOwnerAcks(
    operationId: string,
    owners: ReadonlySet<string>,
    deps: IdentityRuntimeDeps
): Promise<void> {
    if (owners.size === 0) return;
    const pending = new Set(owners);
    const deadline = deps.now() + ACK_TIMEOUT_MS;
    while (pending.size > 0) {
        for (const owner of pending) {
            if (await deps.readAck(ackKey(operationId, owner))) {
                pending.delete(owner);
            }
        }
        if (pending.size === 0) return;
        if (deps.now() >= deadline) {
            throw new Error(
                `device identity change was not acknowledged by owner(s): ${[
                    ...pending
                ].join(', ')}`
            );
        }
        await deps.sleep(ACK_POLL_MS);
    }
}

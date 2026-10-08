import {randomUUID} from 'node:crypto';
import type AbstractDevice from '../model/AbstractDevice';
import {flush as flushAuditLog} from './AuditLogger';
import {disconnectForIdentityChange} from './DeviceCollector';
import {flush as flushDeviceEvents} from './DeviceEventLogger';
import * as Observability from './Observability';
import {getInstanceId} from './redis/instanceId';
import type {DeviceOwnershipLease, DeviceSignal} from './redis/ports';
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
const OWNERSHIP_HEARTBEAT_BATCH_SIZE = 256;
const IDENTITY_FENCE_TTL_MS = 5 * 60_000;

export type DeviceRuntimeOwnershipLease = DeviceOwnershipLease;

const ownedDeviceLeases = new Map<string, DeviceRuntimeOwnershipLease>();
const deviceOwnershipLeases = new WeakMap<
    AbstractDevice,
    DeviceRuntimeOwnershipLease
>();
let ownershipHeartbeat: ReturnType<typeof setInterval> | null = null;
let ownershipHeartbeatPass: Promise<void> | null = null;

interface OwnershipDeps {
    claim(lease: DeviceRuntimeOwnershipLease, ttlMs: number): Promise<boolean>;
    heartbeatMany(
        leases: readonly DeviceRuntimeOwnershipLease[],
        ttlMs: number
    ): Promise<readonly boolean[]>;
    release(lease: DeviceRuntimeOwnershipLease): Promise<void>;
    disconnect(shellyIDs: readonly string[]): void;
}

const ownershipDeps: OwnershipDeps = {
    claim: (lease, ttlMs) => deviceOwnership.claim(lease, ttlMs),
    heartbeatMany: (leases, ttlMs) =>
        deviceOwnership.heartbeatMany(leases, ttlMs),
    release: (lease) => deviceOwnership.release(lease),
    disconnect: disconnectForIdentityChange
};

function sameOwnershipLease(
    left: DeviceRuntimeOwnershipLease | undefined,
    right: DeviceRuntimeOwnershipLease
): boolean {
    return left?.ownerId === right.ownerId && left.leaseId === right.leaseId;
}

export async function claimDeviceRuntimeOwnership(
    shellyID: string,
    overrides: Partial<OwnershipDeps> = {}
): Promise<DeviceRuntimeOwnershipLease | null> {
    const deps = {...ownershipDeps, ...overrides};
    const lease: DeviceRuntimeOwnershipLease = {
        shellyID,
        ownerId: getInstanceId(),
        leaseId: randomUUID()
    };
    const claimed = await deps.claim(lease, OWNERSHIP_TTL_MS);
    if (!claimed) {
        Observability.incrementCounter('device_ownership_claim_rejected_total');
        return null;
    }
    ownedDeviceLeases.set(shellyID, lease);
    Observability.setGauge('device_ownership_leases', ownedDeviceLeases.size);
    return lease;
}

export async function releaseDeviceRuntimeOwnership(
    lease: DeviceRuntimeOwnershipLease,
    overrides: Partial<OwnershipDeps> = {}
): Promise<void> {
    if (!sameOwnershipLease(ownedDeviceLeases.get(lease.shellyID), lease)) {
        return;
    }
    ownedDeviceLeases.delete(lease.shellyID);
    Observability.setGauge('device_ownership_leases', ownedDeviceLeases.size);
    await (overrides.release ?? ownershipDeps.release)(lease);
}

/**
 * Drop every ownership lease this process holds.
 *
 * Called on shutdown. Without it, a restart leaves one lease per connected device
 * in Redis until the 30s TTL expires, and every device that reconnects in that
 * window is refused with "device connection is owned by another server" — by the
 * process that just died. Observed on a 350-device dev fleet: each refusal counts
 * against that device's reconnect budget, so a 30-second stale window turned into
 * a five-minute throttle for the whole fleet.
 *
 * Failures are swallowed per lease on purpose: shutdown must not hang or abort on
 * one Redis error, and the TTL is still there as the backstop.
 */
export async function releaseAllDeviceRuntimeOwnership(
    overrides: Partial<OwnershipDeps> = {}
): Promise<number> {
    const release = overrides.release ?? ownershipDeps.release;
    const leases = [...ownedDeviceLeases.values()];
    ownedDeviceLeases.clear();
    Observability.setGauge('device_ownership_leases', 0);
    let released = 0;
    for (const lease of leases) {
        try {
            await release(lease);
            released += 1;
        } catch {
            // The TTL expires it shortly; a shutdown must not stall on one key.
        }
    }
    return released;
}

export function bindDeviceRuntimeOwnership(
    device: AbstractDevice,
    lease: DeviceRuntimeOwnershipLease
): void {
    if (device.shellyID !== lease.shellyID) {
        throw new Error('device ownership lease identity mismatch');
    }
    deviceOwnershipLeases.set(device, lease);
}

export async function releaseDeviceRuntimeOwnershipForDevice(
    device: AbstractDevice,
    overrides: Partial<OwnershipDeps> = {}
): Promise<void> {
    const lease = deviceOwnershipLeases.get(device);
    if (!lease) return;
    deviceOwnershipLeases.delete(device);
    await releaseDeviceRuntimeOwnership(lease, overrides);
}

async function releaseCurrentDeviceRuntimeOwnership(
    shellyID: string
): Promise<void> {
    const lease = ownedDeviceLeases.get(shellyID);
    if (lease) await releaseDeviceRuntimeOwnership(lease);
}

export async function heartbeatDeviceRuntimeOwnership(
    overrides: Partial<OwnershipDeps> = {}
): Promise<void> {
    if (ownershipHeartbeatPass) {
        Observability.incrementCounter(
            'device_ownership_heartbeat_coalesced_total'
        );
        return ownershipHeartbeatPass;
    }
    const pass = runDeviceOwnershipHeartbeat(overrides).finally(() => {
        if (ownershipHeartbeatPass === pass) ownershipHeartbeatPass = null;
    });
    ownershipHeartbeatPass = pass;
    return pass;
}

async function runDeviceOwnershipHeartbeat(
    overrides: Partial<OwnershipDeps>
): Promise<void> {
    const deps = {...ownershipDeps, ...overrides};
    const leases = [...ownedDeviceLeases.values()];
    const startedAt = performance.now();
    Observability.setGauge('device_ownership_heartbeat_devices', leases.length);
    Observability.setGauge('device_ownership_heartbeat_in_progress', 1);
    try {
        for (
            let offset = 0;
            offset < leases.length;
            offset += OWNERSHIP_HEARTBEAT_BATCH_SIZE
        ) {
            const batch = leases.slice(
                offset,
                offset + OWNERSHIP_HEARTBEAT_BATCH_SIZE
            );
            const renewed = await deps.heartbeatMany(batch, OWNERSHIP_TTL_MS);
            for (let index = 0; index < batch.length; index++) {
                if (renewed[index] === true) continue;
                const lease = batch[index];
                if (
                    !sameOwnershipLease(
                        ownedDeviceLeases.get(lease.shellyID),
                        lease
                    )
                ) {
                    continue;
                }
                ownedDeviceLeases.delete(lease.shellyID);
                deps.disconnect([lease.shellyID]);
                Observability.incrementCounter('device_ownership_lost_total');
            }
        }
    } finally {
        Observability.setGauge(
            'device_ownership_heartbeat_duration_ms',
            Math.round(performance.now() - startedAt)
        );
        Observability.setGauge('device_ownership_heartbeat_in_progress', 0);
        Observability.setGauge(
            'device_ownership_leases',
            ownedDeviceLeases.size
        );
    }
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
    if (ownershipHeartbeatPass) await ownershipHeartbeatPass;
    const leases = [...ownedDeviceLeases.values()];
    await Promise.all(
        leases.map((lease) => releaseDeviceRuntimeOwnership(lease))
    );
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
        releaseCurrentDeviceRuntimeOwnership(oldShellyID),
        releaseCurrentDeviceRuntimeOwnership(newShellyID)
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

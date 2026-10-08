// Write-behind buffer for device "last seen" stamps. A connect enqueues in
// memory (no DB); createQueueFlusher drains it into one bulk UPDATE on a timer.
// Coalesced by the reported device id so a reconnect storm of N devices flushes
// N rows, not one per reconnect. Mirrors the em_stats/lifetime queue pattern.
//
// The stamp lands on device.list (the single device record) keyed on external_id
// — every admit path reports an id, so record_only/grandfathered devices are
// stamped too, unlike the old identity-keyed write. Posture is last-observed:
// how the device connected this time, stamped alongside its liveness.
//
// The stamp is "the last moment Fleet knew the device was connected": a connect,
// a disconnect, or a periodic stamp of the devices this process holds. Each row
// carries its own time, and the flush keeps the newest, so a late stamp from
// one process never moves the time back.

import type {
    DeviceIngressRiskLevel,
    DeviceIngressSecurityModel,
    DeviceIngressTransport
} from '../../types/api/deviceIngress';

export interface DeviceSeenPosture {
    transport: DeviceIngressTransport;
    securityModel: DeviceIngressSecurityModel;
    riskLevel: DeviceIngressRiskLevel;
    // Trusted path only — stamps the credential's last_used_at. null otherwise.
    credentialId: string | null;
}

export interface DeviceSeenRow {
    reportedExternalId: string;
    seenAtMs: number;
    // How the device connected; null for a disconnect or a periodic stamp.
    posture: DeviceSeenPosture | null;
}

export interface DeviceSeenBatch {
    p_external: string[];
    p_seen_at: string[];
    p_transport: (DeviceIngressTransport | null)[];
    p_security: (DeviceIngressSecurityModel | null)[];
    p_risk: (DeviceIngressRiskLevel | null)[];
    p_credential: (string | null)[];
}

export interface ConnectedDevice {
    shellyID: string;
    presence: string;
}

export class DeviceSeenQueue {
    // One row per device: the newest time, and the latest connect's posture.
    #latest = new Map<string, DeviceSeenRow>();

    enqueue(row: DeviceSeenRow): void {
        const previous = this.#latest.get(row.reportedExternalId);
        this.#latest.set(
            row.reportedExternalId,
            previous ? mergeSeen(previous, row) : row
        );
    }

    // The devices this process holds a connection for were seen just now.
    stampConnected(devices: Iterable<ConnectedDevice>, atMs: number): void {
        for (const device of devices) {
            if (device.presence !== 'online') continue;
            this.enqueue({
                reportedExternalId: device.shellyID,
                seenAtMs: atMs,
                posture: null
            });
        }
    }

    size(): number {
        return this.#latest.size;
    }

    drain(): DeviceSeenBatch {
        const rows = [...this.#latest.values()];
        this.#latest.clear();
        return {
            p_external: rows.map((r) => r.reportedExternalId),
            p_seen_at: rows.map((r) => new Date(r.seenAtMs).toISOString()),
            p_transport: rows.map((r) => r.posture?.transport ?? null),
            p_security: rows.map((r) => r.posture?.securityModel ?? null),
            p_risk: rows.map((r) => r.posture?.riskLevel ?? null),
            p_credential: rows.map((r) => r.posture?.credentialId ?? null)
        };
    }

    // Re-queue a failed batch under anything that arrived since the flush
    // started: the newer posture wins and the time never moves back.
    prepend(batch: DeviceSeenBatch): void {
        for (let i = 0; i < batch.p_external.length; i++) {
            const failed = failedRow(batch, i);
            const newer = this.#latest.get(failed.reportedExternalId);
            this.#latest.set(
                failed.reportedExternalId,
                newer ? mergeSeen(failed, newer) : failed
            );
        }
    }
}

// The rows of a batch that belong to the given devices, for a retry.
export function seenBatchFor(
    batch: DeviceSeenBatch,
    externalIds: readonly string[]
): DeviceSeenBatch {
    const wanted = new Set(externalIds);
    const keep = batch.p_external
        .map((externalId, i) => (wanted.has(externalId) ? i : -1))
        .filter((i) => i >= 0);
    return {
        p_external: keep.map((i) => batch.p_external[i]),
        p_seen_at: keep.map((i) => batch.p_seen_at[i]),
        p_transport: keep.map((i) => batch.p_transport[i]),
        p_security: keep.map((i) => batch.p_security[i]),
        p_risk: keep.map((i) => batch.p_risk[i]),
        p_credential: keep.map((i) => batch.p_credential[i])
    };
}

function mergeSeen(older: DeviceSeenRow, newer: DeviceSeenRow): DeviceSeenRow {
    return {
        reportedExternalId: newer.reportedExternalId,
        seenAtMs: Math.max(older.seenAtMs, newer.seenAtMs),
        posture: newer.posture ?? older.posture
    };
}

function failedRow(batch: DeviceSeenBatch, i: number): DeviceSeenRow {
    const transport = batch.p_transport[i];
    const securityModel = batch.p_security[i];
    const riskLevel = batch.p_risk[i];
    return {
        reportedExternalId: batch.p_external[i],
        seenAtMs: Date.parse(batch.p_seen_at[i]),
        posture:
            transport && securityModel && riskLevel
                ? {
                      transport,
                      securityModel,
                      riskLevel,
                      credentialId: batch.p_credential[i]
                  }
                : null
    };
}

// Process-wide singleton — production wiring point (gate enqueues, flusher drains).
export const deviceSeenQueue = new DeviceSeenQueue();

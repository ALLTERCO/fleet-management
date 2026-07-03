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
// The stamp time is the flush's now() — "last seen" is presence and tolerates
// up to one flush interval of staleness; live connectivity is the in-memory
// connection registry, not this durable mirror.

import type {
    DeviceIngressRiskLevel,
    DeviceIngressSecurityModel,
    DeviceIngressTransport
} from '../../types/api/deviceIngress';

export interface DeviceSeenRow {
    reportedExternalId: string;
    transport: DeviceIngressTransport;
    securityModel: DeviceIngressSecurityModel;
    riskLevel: DeviceIngressRiskLevel;
    // Trusted path only — stamps the credential's last_used_at. null otherwise.
    credentialId: string | null;
}

export interface DeviceSeenBatch {
    p_external: string[];
    p_transport: DeviceIngressTransport[];
    p_security: DeviceIngressSecurityModel[];
    p_risk: DeviceIngressRiskLevel[];
    p_credential: (string | null)[];
}

export class DeviceSeenQueue {
    // Latest stamp per device — repeated connects coalesce to one row.
    #latest = new Map<string, DeviceSeenRow>();

    enqueue(row: DeviceSeenRow): void {
        this.#latest.set(row.reportedExternalId, row);
    }

    size(): number {
        return this.#latest.size;
    }

    drain(): DeviceSeenBatch {
        const rows = [...this.#latest.values()];
        this.#latest.clear();
        return {
            p_external: rows.map((r) => r.reportedExternalId),
            p_transport: rows.map((r) => r.transport),
            p_security: rows.map((r) => r.securityModel),
            p_risk: rows.map((r) => r.riskLevel),
            p_credential: rows.map((r) => r.credentialId)
        };
    }

    // Re-queue a failed batch, but never clobber a fresher stamp that arrived
    // since the flush started — the newest connect for a device always wins.
    prepend(batch: DeviceSeenBatch): void {
        for (let i = 0; i < batch.p_external.length; i++) {
            const externalId = batch.p_external[i];
            if (this.#latest.has(externalId)) continue;
            this.#latest.set(externalId, {
                reportedExternalId: externalId,
                transport: batch.p_transport[i],
                securityModel: batch.p_security[i],
                riskLevel: batch.p_risk[i],
                credentialId: batch.p_credential[i]
            });
        }
    }
}

// Process-wide singleton — production wiring point (gate enqueues, flusher drains).
export const deviceSeenQueue = new DeviceSeenQueue();

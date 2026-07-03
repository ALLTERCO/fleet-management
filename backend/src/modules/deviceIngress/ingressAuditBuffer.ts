// Redis-buffered ingress audit records. The gate enqueues here on connect (one
// fast Redis push) instead of writing Postgres inline; the flusher drains and
// bulk-inserts them. One buffer, one flush — no per-connect DB write.
import * as Observability from '../Observability';
import {ingressAudit} from '../redis/services';

// Cap the buffer so a stalled flush can't grow Redis without bound; sized well
// above a realistic backlog, and overflow drops oldest at the Redis layer.
const BUFFER_MAXLEN = 100_000;
// A buffer no flusher drains self-clears within the hour instead of leaking.
const BUFFER_TTL_MS = 3_600_000;

// The per-connect connection row, deferred off the hot path. `id` is minted by
// the caller so the trusted path can register the live connection immediately,
// before the row is actually written to Postgres.
export interface IngressConnectionEvent {
    kind: 'connection';
    id: string;
    // ISO connect time, stamped at enqueue so the flushed row keeps the real
    // connect instant, not the (slightly later) flush time.
    createdAt: string;
    organizationId: string;
    identityId: string | null;
    credentialId: string | null;
    reportedExternalId: string | null;
    observedTransport: string;
    result: string;
    reasonCode: string | null;
    remoteAddressHash: string | null;
    safeDetail: Record<string, unknown>;
    userAgent: string | null;
}

export type IngressAuditEvent = IngressConnectionEvent;

export async function enqueueIngressAudit(
    event: IngressAuditEvent
): Promise<void> {
    await ingressAudit.push(
        JSON.stringify(event),
        BUFFER_MAXLEN,
        BUFFER_TTL_MS
    );
}

export async function drainIngressAudit(
    max: number
): Promise<IngressAuditEvent[]> {
    const raw = await ingressAudit.drain(max);
    const events: IngressAuditEvent[] = [];
    for (const item of raw) {
        const parsed = parseEvent(item);
        if (parsed) events.push(parsed);
    }
    return events;
}

export function ingressAuditDepth(): Promise<number> {
    return ingressAudit.size();
}

function parseEvent(raw: string): IngressAuditEvent | null {
    try {
        const parsed = JSON.parse(raw) as IngressAuditEvent;
        if (parsed?.kind === 'connection') return parsed;
        Observability.incrementCounter('ingress_audit_unknown_kind');
        return null;
    } catch {
        Observability.incrementCounter('ingress_audit_poison');
        return null;
    }
}

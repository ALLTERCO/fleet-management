// Drains the Redis ingress-audit buffer and bulk-inserts to Postgres on a timer.
// Idempotent inserts make a double-flush harmless; a failed insert re-enqueues
// the batch so a transient DB outage never loses audit rows.
import log4js from 'log4js';
import * as Observability from '../Observability';
import {isLeader, startLeaderGate} from '../redis/leaderGate';
import {bulkInsertConnections} from './deviceIngressRepository';
import {
    drainIngressAudit,
    enqueueIngressAudit,
    type IngressConnectionEvent
} from './ingressAuditBuffer';

const logger = log4js.getLogger('ingress-audit-flush');

// Only the leader drains the shared per-org buffer, so N instances don't all
// hammer Redis/Postgres each tick (the atomic drain keeps it correct either way).
const LEADER_NAME = 'ingress-audit-flush';
// One bulk INSERT stays a single round-trip at this batch size.
const FLUSH_BATCH = 500;
// Frequent enough that rows land promptly; an idle tick is one empty Redis read.
const FLUSH_INTERVAL_MS = 500;

type ConnectionInsert = (records: IngressConnectionEvent[]) => Promise<void>;

let timer: NodeJS.Timeout | null = null;
let flushing = false;

export async function flushIngressAudit(
    insertConnections: ConnectionInsert = bulkInsertConnections
): Promise<number> {
    if (flushing) return 0;
    flushing = true;
    let total = 0;
    try {
        for (;;) {
            const events = await drainIngressAudit(FLUSH_BATCH);
            if (events.length === 0) break;
            try {
                const connections = events.filter(
                    (e) => e.kind === 'connection'
                );
                if (connections.length > 0)
                    await insertConnections(connections);
                Observability.incrementCounter('ingress_audit_flushed_total');
                total += events.length;
            } catch (err) {
                // The drain already removed these from Redis; put them back so a
                // transient DB outage doesn't drop audit rows.
                Observability.incrementCounter('ingress_audit_flush_requeued');
                for (const event of events) await enqueueIngressAudit(event);
                logger.error(
                    'ingress-audit flush failed, requeued %d: %s',
                    events.length,
                    err
                );
                break;
            }
            if (events.length < FLUSH_BATCH) break;
        }
    } finally {
        flushing = false;
    }
    return total;
}

export function startIngressAuditFlusher(): void {
    if (timer) return;
    void startLeaderGate(LEADER_NAME);
    timer = setInterval(() => {
        if (!isLeader(LEADER_NAME)) return;
        void flushIngressAudit().catch((err) =>
            logger.error('ingress-audit flush tick failed: %s', err)
        );
    }, FLUSH_INTERVAL_MS);
    timer.unref?.();
}

export function stopIngressAuditFlusher(): void {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

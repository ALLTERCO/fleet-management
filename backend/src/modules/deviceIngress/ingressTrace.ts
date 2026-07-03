// One home for tracing a device's whole journey — WS connect → waiting room →
// accept → registered → persisted. Each stage logs the ms since connect and
// bumps a counter, so the lifecycle is greppable in the log and measurable in
// observability. Grep a device's shellyID to see its full timeline.
import log4js from 'log4js';
import {BoundedMap} from '../boundedMap';
import {incrementCounter} from '../Observability';

const logger = log4js.getLogger('ingress-trace');

// Connect time per device. Bounded + TTL so a connect storm can't grow it;
// cleared when the device registers or its socket closes.
const connectAt = new BoundedMap<string, number>({
    maxSize: 20_000,
    ttlMs: 15 * 60 * 1000
});

/** "<id> <stage> +<ms>ms [detail]" — pure, so it's testable. */
export function traceLine(
    shellyID: string,
    stage: string,
    msSinceConnect: number,
    detail?: string
): string {
    const age = msSinceConnect >= 0 ? `+${msSinceConnect}ms` : '+unknown';
    return `${shellyID} ${stage} ${age}${detail ? ` ${detail}` : ''}`;
}

/** Stage → a Prometheus-safe counter name. Pure, so it's testable. */
export function stageMetric(stage: string): string {
    return `ingress_stage_${stage.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`;
}

export function ingressConnect(shellyID: string): void {
    connectAt.set(shellyID, Date.now());
    emit(shellyID, 'connect');
}

export function ingressStage(
    shellyID: string,
    stage: string,
    detail?: string
): void {
    emit(shellyID, stage, detail);
}

// Operational finish: the device is in DeviceCollector and device.list returns
// it (commands work now — DB admit already landed at accept, audit trail is
// batched off the path). Logs, then frees the entry.
export function ingressRegistered(shellyID: string, detail?: string): void {
    emit(shellyID, 'registered', detail);
    connectAt.delete(shellyID);
}

// Terminal failure: the socket closed before the device went live (queue full,
// cooldown, config unavailable, rejected). Logs the reason, bumps a total and a
// per-reason counter so drops are countable by cause, then frees the clock.
export function ingressDropped(shellyID: string, reason: string): void {
    emit(shellyID, 'dropped', reason);
    incrementCounter(stageMetric(`dropped_${reason}`));
    connectAt.delete(shellyID);
}

// BLU children are born from a gateway report, not a WS connect — a separate
// door. promote starts their clock (their birth); demote ends it.
export function ingressBluPromoted(bluId: string, detail?: string): void {
    connectAt.set(bluId, Date.now());
    emit(bluId, 'blu-promoted', detail);
}

export function ingressBluDemoted(bluId: string, detail?: string): void {
    emit(bluId, 'blu-demoted', detail);
    connectAt.delete(bluId);
}

export function ingressClosed(shellyID: string): void {
    connectAt.delete(shellyID);
}

function emit(shellyID: string, stage: string, detail?: string): void {
    const startedAt = connectAt.get(shellyID);
    const ms = startedAt === undefined ? -1 : Date.now() - startedAt;
    logger.info(traceLine(shellyID, stage, ms, detail));
    incrementCounter(stageMetric(stage));
}

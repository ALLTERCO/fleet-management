// Sessions whose socket closed but whose events are still being captured,
// keyed by owner + connectionId, each with a grace timer.
import {tuning} from '../../../config';
import * as Observability from '../../Observability';
import {runExclusive} from './keyedSerialQueue';
import type {SessionCapture} from './sessionCapture';

export interface SessionOwner {
    userId: string;
    organizationId: string | undefined;
}

export interface ResumePolicy {
    graceMs: number;
    maxGapEvents: number;
    probeMs: number;
}

export interface ParkedSession {
    owner: SessionOwner;
    capture: SessionCapture;
    /** Ends capture and deletes the stream; runs when grace expires. */
    discard: () => Promise<void>;
}

interface ParkedEntry extends ParkedSession {
    timer: NodeJS.Timeout;
}

const parked = new Map<string, ParkedEntry>();
let policyOverride: ResumePolicy | undefined;

// Grace never outlives the stream TTL, and the gap never exceeds MAXLEN, so
// Redis can't trim or expire a gap entry the resume still promises.
export function resumePolicy(): ResumePolicy {
    if (policyOverride) return policyOverride;
    return {
        graceMs: Math.min(tuning.ws.resumeGraceMs, tuning.ws.streamTtlMs),
        maxGapEvents: Math.min(
            tuning.ws.resumeMaxEvents,
            tuning.ws.streamMaxlen
        ),
        probeMs: tuning.ws.resumeProbeMs
    };
}

export function sessionKey(owner: SessionOwner, connectionId: string): string {
    return `${owner.userId}:${connectionId}`;
}

export function sameOwner(left: SessionOwner, right: SessionOwner): boolean {
    return (
        left.userId === right.userId &&
        left.organizationId === right.organizationId
    );
}

export function parkSession(key: string, session: ParkedSession): void {
    // Under the session lock so a resume never races the stream delete.
    const timer = setTimeout(
        () => void runExclusive(key, () => expireParkedSession(key)),
        resumePolicy().graceMs
    );
    timer.unref();
    parked.set(key, {...session, timer});
    Observability.setGauge('ws_resume_parked_sessions', parked.size);
}

export function findParkedSession(key: string): ParkedSession | undefined {
    return parked.get(key);
}

/** Stops the grace timer; the caller now owns the session. */
export function unparkSession(key: string): void {
    const entry = parked.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    parked.delete(key);
    Observability.setGauge('ws_resume_parked_sessions', parked.size);
}

async function expireParkedSession(key: string): Promise<void> {
    const entry = parked.get(key);
    if (!entry) return;
    unparkSession(key);
    Observability.incrementCounter('ws_resume_grace_expired');
    await entry.discard();
}

export function setResumePolicyForTests(
    policy: ResumePolicy | undefined
): void {
    policyOverride = policy;
}

export async function resetParkedSessionsForTests(): Promise<void> {
    const keys = [...parked.keys()];
    for (const key of keys) await expireParkedSession(key);
}

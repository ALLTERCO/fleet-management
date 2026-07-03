// heartbeat — fires when expected telemetry hasn't arrived for
// expectedIntervalSec. Inverse of device_offline: device_offline fires on
// a transport-level disconnect event; heartbeat fires when status updates
// simply stop. The periodic sweep that synthesises misses lives outside
// this file; here we expose the schema/registry hook and the matchClear
// path used when telemetry resumes.

import {
    BLU_MISSED_REPORTS_TOLERANCE,
    bluHeartbeatFloorSec
} from '../../../config/BTHomeData';
import {tuning} from '../../../config/tuning';
import type AbstractDevice from '../../../model/AbstractDevice';
import type {bthomedevice_entity} from '../../../types';
import {fingerprintV2} from '../fingerprint';
import {heartbeatMissed} from '../sweepSampling';
import type {Evaluator, MatchResult} from '../types';
import {readNumber} from './shared';

const KIND = 'heartbeat';

function heartbeatFingerprint(ruleId: number, shellyID: string): string {
    return fingerprintV2({ruleId, subjectType: 'device', subjectId: shellyID});
}

// A BLU device reports through its gateway; the gateway can stay online while
// the BLU device falls silent, so it gets its own fingerprint.
function bluHeartbeatFingerprint(
    ruleId: number,
    shellyID: string,
    component: string
): string {
    return fingerprintV2({
        ruleId,
        subjectType: 'device',
        subjectId: shellyID,
        discriminator: `:blu:${component}`
    });
}

export interface BluTarget {
    component: string;
    lastReportMs: number;
    /** The model's guaranteed report cadence (seconds) — see bluHeartbeatInterval. */
    floorSec: number;
}

/** Silence (seconds) before a BLU device of this model is judged offline: its
 *  guaranteed cadence times the miss tolerance, never tighter than the rule's
 *  own expected interval. */
export function bluHeartbeatInterval(
    configSec: number,
    floorSec: number
): number {
    return Math.max(configSec, floorSec * BLU_MISSED_REPORTS_TOLERANCE);
}

// BLU devices the gateway already exposes as `bthomedevice` entities, each with
// its own last_updated_ts (Unix seconds) in the device's status and its cadence
// keyed off the discovered model. Reuses the device surface — the single source
// of truth for what BLU devices exist. Models with no safe cadence are skipped.
export function bluLivenessTargets(device: AbstractDevice): BluTarget[] {
    const out: BluTarget[] = [];
    for (const e of device.entities) {
        if (e.type !== 'bthomedevice') continue;
        const floorSec = bluHeartbeatFloorSec(
            (e as bthomedevice_entity).properties.modelId
        );
        if (floorSec === null) continue; // model excluded from heartbeat
        const component = `${e.type}:${e.properties.id}`;
        const ts = readNumber(device.status, `${component}.last_updated_ts`);
        if (ts !== null) {
            out.push({
                component,
                lastReportMs: Math.round(ts * 1000),
                floorSec
            });
        }
    }
    return out;
}

export const heartbeatEvaluator: Evaluator = {
    // Engine periodic sweep produces synthetic match results; no direct
    // event maps to a heartbeat MISS.
    triggerKinds: ['device_status_changed'],
    clearKinds: ['device_status_changed'],

    match(_event, _rule): MatchResult | null {
        // Status arrival is the CLEAR signal; never a trigger.
        return null;
    },

    matchClear(event, rule) {
        if (rule.kind !== KIND) return null;
        if (event.kind !== 'device_status_changed') return null;
        return {fingerprintV2: heartbeatFingerprint(rule.id, event.shellyID)};
    },

    // Gateway telemetry clears the device-level miss; each BLU device clears
    // only once it is itself reporting fresh again, so a live gateway can't
    // resolve a silent BLU device.
    matchClearAll(event, rule): readonly string[] {
        const base = heartbeatEvaluator.matchClear?.(event, rule);
        if (!base) return [];
        const out: string[] = [base.fingerprintV2];
        if (event.kind === 'device_status_changed' && event.device) {
            const now = Date.now();
            const configSec =
                typeof rule.config.expectedIntervalSec === 'number'
                    ? rule.config.expectedIntervalSec
                    : 0;
            for (const t of bluLivenessTargets(event.device)) {
                const interval = bluHeartbeatInterval(configSec, t.floorSec);
                const fresh = !heartbeatMissed(
                    t.lastReportMs,
                    now,
                    interval,
                    tuning.alert.sweepEvalDelaySec
                );
                if (fresh) {
                    out.push(
                        bluHeartbeatFingerprint(
                            rule.id,
                            event.shellyID,
                            t.component
                        )
                    );
                }
            }
        }
        return out;
    }
};

// Exported for the engine's periodic sweep — builds the synthetic match when
// the window has elapsed without telemetry. A `component` marks a BLU device
// miss; absent, it is the gateway/native device itself.
export function synthesizeHeartbeatMiss(input: {
    ruleId: number;
    ruleName: string;
    shellyID: string;
    expectedIntervalSec: number;
    component?: string;
}): MatchResult {
    const label = input.component
        ? `${input.shellyID} ${input.component}`
        : input.shellyID;
    return {
        fingerprintV2: input.component
            ? bluHeartbeatFingerprint(
                  input.ruleId,
                  input.shellyID,
                  input.component
              )
            : heartbeatFingerprint(input.ruleId, input.shellyID),
        title: `${label} heartbeat missed`,
        message:
            `No telemetry from ${label} for at least ` +
            `${input.expectedIntervalSec}s. Rule: ${input.ruleName}.`,
        subject: {type: 'device', id: input.shellyID},
        context: {
            shellyID: input.shellyID,
            expectedIntervalSec: input.expectedIntervalSec,
            ...(input.component ? {component: input.component} : {})
        }
    };
}

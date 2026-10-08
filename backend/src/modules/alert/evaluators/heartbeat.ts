// heartbeat — fires when expected telemetry hasn't arrived for
// expectedIntervalSec. Inverse of device_offline: device_offline fires on
// a transport-level disconnect event; heartbeat fires when status updates
// simply stop. The periodic sweep that synthesises misses lives outside
// this file; here we expose the schema/registry hook and the matchClear
// path used when telemetry resumes.

import {fingerprintV2} from '../fingerprint';
import type {Evaluator, MatchResult} from '../types';

const KIND = 'heartbeat';

function heartbeatFingerprint(ruleId: number, shellyID: string): string {
    return fingerprintV2({ruleId, subjectType: 'device', subjectId: shellyID});
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
    }
};

// Exported for the engine's periodic sweep — builds the synthetic match when
// the window has elapsed without telemetry.
export function synthesizeHeartbeatMiss(input: {
    ruleId: number;
    ruleName: string;
    shellyID: string;
    expectedIntervalSec: number;
}): MatchResult {
    return {
        fingerprintV2: heartbeatFingerprint(input.ruleId, input.shellyID),
        title: `${input.shellyID} heartbeat missed`,
        message:
            `No telemetry from ${input.shellyID} for at least ` +
            `${input.expectedIntervalSec}s. Rule: ${input.ruleName}.`,
        subject: {type: 'device', id: input.shellyID},
        context: {
            shellyID: input.shellyID,
            expectedIntervalSec: input.expectedIntervalSec
        }
    };
}

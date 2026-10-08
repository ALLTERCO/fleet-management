// credential_expiring — the sweep synthesizes the match from the ingress
// credential table; no device event can trigger or clear it.

import {fingerprintV2} from '../fingerprint';
import type {Evaluator, MatchResult} from '../types';

export function credentialExpiringFingerprint(
    ruleId: number,
    shellyID: string
): string {
    return fingerprintV2({ruleId, subjectType: 'device', subjectId: shellyID});
}

export const credentialExpiringEvaluator: Evaluator = {
    triggerKinds: [],

    match(_event, _rule): MatchResult | null {
        return null;
    }
};

// Exported for the engine's periodic sweep — builds the synthetic match when
// a device key is inside the configured warning window.
export function synthesizeCredentialExpiring(input: {
    ruleId: number;
    ruleName: string;
    shellyID: string;
    deviceName?: string;
    endsAt: string;
    daysLeft: number;
}): MatchResult {
    const display = input.deviceName || input.shellyID;
    const title =
        input.daysLeft === 0
            ? `${display} key has ended`
            : input.daysLeft === 1
              ? `${display} key ends in 1 day`
              : `${display} key ends in ${input.daysLeft} days`;
    return {
        fingerprintV2: credentialExpiringFingerprint(
            input.ruleId,
            input.shellyID
        ),
        title,
        message:
            `The key for ${display} (${input.shellyID}) ends on ` +
            `${input.endsAt}. Rotate it before then. Rule: ${input.ruleName}.`,
        subject: {type: 'device', id: input.shellyID},
        context: {
            shellyID: input.shellyID,
            ...(input.deviceName ? {deviceName: input.deviceName} : {}),
            endsAt: input.endsAt,
            daysLeft: input.daysLeft
        }
    };
}

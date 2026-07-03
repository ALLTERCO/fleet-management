// device_offline — fires on Shelly.Disconnect; auto-resolves on Shelly.Connect.
import {fingerprintV2} from '../fingerprint';
import type {Evaluator, MatchResult} from '../types';

const KIND = 'device_offline';

function offlineFingerprint(ruleId: number, shellyID: string): string {
    return fingerprintV2({ruleId, subjectType: 'device', subjectId: shellyID});
}

export function buildDeviceOfflineMatch(
    ruleId: number,
    ruleName: string,
    shellyID: string,
    deviceName: string | undefined,
    context: Record<string, unknown> = {}
): MatchResult {
    const display = deviceName || shellyID;
    return {
        fingerprintV2: offlineFingerprint(ruleId, shellyID),
        title: `${display} is offline`,
        message: `Device ${display} (${shellyID}) stopped reporting. Rule: ${ruleName}.`,
        subject: {type: 'device', id: shellyID},
        context: {shellyID, ...context}
    };
}

export const deviceOfflineEvaluator: Evaluator = {
    triggerKinds: ['device_offline'],
    clearKinds: ['device_online'],

    match(event, rule) {
        if (rule.kind !== KIND) return null;
        if (event.kind !== 'device_offline') return null;
        return buildDeviceOfflineMatch(
            rule.id,
            rule.name,
            event.shellyID,
            event.device?.info?.name as string | undefined
        );
    },

    matchClear(event, rule) {
        if (rule.kind !== KIND) return null;
        if (event.kind !== 'device_online') return null;
        return {fingerprintV2: offlineFingerprint(rule.id, event.shellyID)};
    }
};

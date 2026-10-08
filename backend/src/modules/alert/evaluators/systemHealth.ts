// system_health — the product reports its own problems to the tenant's
// admins. One open alert per check; a 'resolved' event with the same check
// clears it.
import {fingerprintV2} from '../fingerprint';
import type {Evaluator, MatchResult} from '../types';

const KIND = 'system_health';

function checkFingerprint(ruleId: number, check: string): string {
    return fingerprintV2({ruleId, subjectType: 'system', subjectId: check});
}

export const systemHealthEvaluator: Evaluator = {
    triggerKinds: ['system_health'],
    clearKinds: ['system_health'],

    match(event, rule): MatchResult | null {
        if (rule.kind !== KIND) return null;
        if (event.kind !== 'system_health' || event.status !== 'firing') {
            return null;
        }
        return {
            fingerprintV2: checkFingerprint(rule.id, event.check),
            title: event.title,
            message: event.message,
            subject: {type: 'system', id: event.check},
            context: {
                check: event.check,
                metric: event.metric,
                value: event.value,
                action: event.action
            }
        };
    },

    matchClear(event, rule): {fingerprintV2: string} | null {
        if (rule.kind !== KIND) return null;
        if (event.kind !== 'system_health' || event.status !== 'resolved') {
            return null;
        }
        return {fingerprintV2: checkFingerprint(rule.id, event.check)};
    }
};

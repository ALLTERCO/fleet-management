// grafana_alert — external Grafana alert; fires on 'firing', auto-resolves on 'resolved'.
import {fingerprintV2} from '../fingerprint';
import type {Evaluator, MatchResult} from '../types';

const KIND = 'grafana_alert';

// No discriminator — the clear path must reproduce the firing fingerprint.
function alertFingerprint(ruleId: number, grafanaFingerprint: string): string {
    return fingerprintV2({
        ruleId,
        subjectType: 'entity',
        subjectId: grafanaFingerprint
    });
}

export const grafanaAlertEvaluator: Evaluator = {
    triggerKinds: ['grafana_alert'],
    clearKinds: ['grafana_alert'],

    match(event, rule): MatchResult | null {
        if (rule.kind !== KIND) return null;
        if (event.kind !== 'grafana_alert' || event.status !== 'firing') {
            return null;
        }
        return {
            fingerprintV2: alertFingerprint(rule.id, event.fingerprint),
            title: `Grafana: ${event.alertName}`,
            message: event.summary,
            subject: {type: 'entity', id: event.fingerprint},
            context: {
                alertName: event.alertName,
                labels: event.labels,
                annotations: event.annotations
            }
        };
    },

    matchClear(event, rule): {fingerprintV2: string} | null {
        if (rule.kind !== KIND) return null;
        if (event.kind !== 'grafana_alert' || event.status !== 'resolved') {
            return null;
        }
        return {fingerprintV2: alertFingerprint(rule.id, event.fingerprint)};
    }
};

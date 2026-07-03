// Factory for binary sensor-alarm evaluators (flood, smoke, motion). They
// share one shape: scan every device signal, fire on the first that detects,
// auto-resolve when a signal reports clear. Each sensor supplies only its own
// detect/clear/text; the match + clear skeleton lives here once.

import type {AlertRuleKind} from '../../../types/api/alert';
import {fingerprintV2} from '../fingerprint';
import {collectSignals, type Signal} from '../signals';
import type {Evaluator, MatchResult} from '../types';

export interface SensorAlarmSpec {
    kind: AlertRuleKind;
    // Channel id when the signal is alarming, else null.
    detect: (signal: Signal) => string | null;
    // True when the signal is explicitly clear (drives auto-resolve).
    isClear: (signal: Signal) => boolean;
    title: (signal: Signal) => string;
    message: (signal: Signal, channel: string) => string;
    // Omit to fall back to the rule's own severity.
    severity?: MatchResult['severity'];
}

export function makeSensorAlarmEvaluator(spec: SensorAlarmSpec): Evaluator {
    return {
        triggerKinds: ['device_status_changed'],
        clearKinds: ['device_status_changed'],

        match(event, rule): MatchResult | null {
            if (rule.kind !== spec.kind) return null;
            if (event.kind !== 'device_status_changed') return null;
            if (!event.device) return null;
            for (const signal of collectSignals(event.device)) {
                const channel = spec.detect(signal);
                if (!channel) continue;
                return {
                    fingerprintV2: fingerprintV2({
                        ruleId: rule.id,
                        subjectType: signal.subjectType,
                        subjectId: signal.subjectId
                    }),
                    title: spec.title(signal),
                    message: spec.message(signal, channel),
                    ...(spec.severity ? {severity: spec.severity} : {}),
                    subject: {type: signal.subjectType, id: signal.subjectId},
                    context: {shellyID: signal.gatewayShellyID, channel}
                };
            }
            return null;
        },

        // Resolve every cleared subject, not just the first.
        matchClearAll(event, rule): string[] {
            if (rule.kind !== spec.kind) return [];
            if (event.kind !== 'device_status_changed') return [];
            if (!event.device) return [];
            const out: string[] = [];
            for (const signal of collectSignals(event.device)) {
                if (!spec.isClear(signal)) continue;
                out.push(
                    fingerprintV2({
                        ruleId: rule.id,
                        subjectType: signal.subjectType,
                        subjectId: signal.subjectId
                    })
                );
            }
            return out;
        },

        matchClear(event, rule) {
            const [first] = this.matchClearAll?.(event, rule) ?? [];
            return first ? {fingerprintV2: first} : null;
        }
    };
}

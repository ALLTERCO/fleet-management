/** automation_run_failed — subject is the automation, manual-resolve. */
import {fingerprintV2, timestampedDiscriminator} from '../fingerprint';
import type {Evaluator, MatchResult} from '../types';

const KIND = 'automation_run_failed';

export const automationRunFailedEvaluator: Evaluator = {
    triggerKinds: ['automation_run_failed'],

    match(event, rule): MatchResult | null {
        if (rule.kind !== KIND) return null;
        if (event.kind !== 'automation_run_failed') return null;
        return {
            fingerprintV2: fingerprintV2({
                ruleId: rule.id,
                subjectType: 'entity',
                subjectId: String(event.automationId),
                discriminator: timestampedDiscriminator(Date.now())
            }),
            title: `Automation "${event.automationName}" failed`,
            message: event.errorMessage,
            subject: {type: 'entity', id: String(event.automationId)},
            context: {
                automationId: event.automationId,
                automationName: event.automationName,
                error: event.errorMessage
            }
        };
    }
};

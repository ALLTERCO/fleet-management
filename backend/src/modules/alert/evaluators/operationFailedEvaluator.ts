// Factory for device operation-failed evaluators (backup, firmware). Both fire
// a manual-resolve incident on every occurrence — same fingerprint + result
// shape; only the title differs.

import {fingerprintV2, timestampedDiscriminator} from '../fingerprint';
import type {Evaluator, MatchResult} from '../types';

type OperationFailedKind =
    | 'backup_operation_failed'
    | 'firmware_operation_failed';

export function makeOperationFailedEvaluator(
    kind: OperationFailedKind,
    title: (shellyID: string) => string
): Evaluator {
    return {
        triggerKinds: [kind],

        match(event, rule): MatchResult | null {
            if (rule.kind !== kind) return null;
            // Literal-pair check narrows the event to the two failure members
            // (both carry shellyID + errorMessage); the kind check then pins
            // it to this evaluator's own kind.
            if (
                event.kind !== 'backup_operation_failed' &&
                event.kind !== 'firmware_operation_failed'
            ) {
                return null;
            }
            if (event.kind !== kind) return null;
            return {
                fingerprintV2: fingerprintV2({
                    ruleId: rule.id,
                    subjectType: 'device',
                    subjectId: event.shellyID,
                    discriminator: timestampedDiscriminator(Date.now())
                }),
                title: title(event.shellyID),
                message: event.errorMessage,
                subject: {type: 'device', id: event.shellyID},
                context: {shellyID: event.shellyID, error: event.errorMessage}
            };
        }
    };
}

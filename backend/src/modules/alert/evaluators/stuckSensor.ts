// stuck_sensor — fires when a reading hasn't changed for notChangedForSec.
// Engine sweep tracks last-changed timestamp per (rule, device, field).

import {fingerprintV2} from '../fingerprint';
import type {MatchResult} from '../types';
import {makeSweepDrivenEvaluator} from './sweepDrivenEvaluator';

export const stuckSensorEvaluator = makeSweepDrivenEvaluator('stuck_sensor');

export function synthesizeStuckSensorMiss(input: {
    ruleId: number;
    ruleName: string;
    shellyID: string;
    component: string;
    field: string;
    notChangedForSec: number;
}): MatchResult {
    return {
        fingerprintV2: fingerprintV2({
            ruleId: input.ruleId,
            subjectType: 'device',
            subjectId: input.shellyID
        }),
        title: `${input.shellyID} ${input.component}.${input.field} stuck`,
        message:
            `${input.component}.${input.field} has not changed for at least ` +
            `${input.notChangedForSec}s. Rule: ${input.ruleName}.`,
        subject: {type: 'device', id: input.shellyID},
        context: {
            shellyID: input.shellyID,
            component: input.component,
            field: input.field,
            notChangedForSec: input.notChangedForSec
        }
    };
}

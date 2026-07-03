// rate_of_change — fires when (current - previous)/windowSec exceeds
// deltaValue. Needs sliding-window state per (rule, device) — handled by
// the engine sweep. This file is the registry hook + the clear-match
// path used when the rate falls back under deltaValue.

import {fingerprintV2} from '../fingerprint';
import type {MatchResult} from '../types';
import {makeSweepDrivenEvaluator} from './sweepDrivenEvaluator';

export const rateOfChangeEvaluator = makeSweepDrivenEvaluator('rate_of_change');

export function synthesizeRateOfChangeMiss(input: {
    ruleId: number;
    ruleName: string;
    shellyID: string;
    component: string;
    field: string;
    rate: number;
    deltaValue: number;
    windowSec: number;
}): MatchResult {
    return {
        fingerprintV2: fingerprintV2({
            ruleId: input.ruleId,
            subjectType: 'device',
            subjectId: input.shellyID
        }),
        title: `${input.shellyID} ${input.component}.${input.field} rate exceeded`,
        message:
            `${input.component}.${input.field} changed by ${input.rate.toFixed(3)} ` +
            `per second over ${input.windowSec}s — threshold ${input.deltaValue}. ` +
            `Rule: ${input.ruleName}.`,
        subject: {type: 'device', id: input.shellyID},
        context: {
            shellyID: input.shellyID,
            component: input.component,
            field: input.field,
            rate: input.rate,
            deltaValue: input.deltaValue,
            windowSec: input.windowSec
        }
    };
}

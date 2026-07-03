// energy_consumption_threshold — sweep-driven persisted energy window alert.
// Reads rollup/history (`total_act_energy`) instead of live status power.

import {fingerprintV2} from '../fingerprint';
import type {MatchResult} from '../types';
import {makeSweepDrivenEvaluator} from './sweepDrivenEvaluator';

export const energyConsumptionThresholdEvaluator = makeSweepDrivenEvaluator(
    'energy_consumption_threshold'
);

export function synthesizeEnergyConsumptionThreshold(input: {
    ruleId: number;
    ruleName: string;
    shellyID: string;
    consumptionKWh: number;
    thresholdKWh: number;
    operator: string;
    windowSec: number;
    sampleCount: number;
}): MatchResult {
    return {
        fingerprintV2: fingerprintV2({
            ruleId: input.ruleId,
            subjectType: 'device',
            subjectId: input.shellyID
        }),
        title: `${input.shellyID} energy consumption threshold`,
        message:
            `${input.consumptionKWh.toFixed(3)} kWh over ${input.windowSec}s ` +
            `${input.operator} ${input.thresholdKWh} kWh. Rule: ${input.ruleName}.`,
        subject: {type: 'device', id: input.shellyID},
        context: {
            shellyID: input.shellyID,
            consumptionKWh: input.consumptionKWh,
            thresholdKWh: input.thresholdKWh,
            operator: input.operator,
            windowSec: input.windowSec,
            sampleCount: input.sampleCount
        }
    };
}

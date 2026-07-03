// Factory for engine-sweep-driven evaluators. Their fire and clear decisions
// both live in RuleSweep, where the time-window state is available.

import type {AlertRuleKind} from '../../../types/api/alert';
import type {Evaluator} from '../types';

export function makeSweepDrivenEvaluator(_kind: AlertRuleKind): Evaluator {
    return {
        triggerKinds: ['device_status_changed'],
        match: () => null
    };
}

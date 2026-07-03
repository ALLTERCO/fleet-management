type OrganizationRuleEvaluationReason = 'scope_changed' | 'startup';

type OrganizationRuleEvaluator = (input: {
    organizationId: string;
    reason: OrganizationRuleEvaluationReason;
}) => void;

let organizationRuleEvaluator: OrganizationRuleEvaluator | null = null;

export function registerOrganizationRuleEvaluator(
    evaluator: OrganizationRuleEvaluator
): void {
    organizationRuleEvaluator = evaluator;
}

export function scheduleOrganizationRuleEvaluation(input: {
    organizationId: string;
    reason: OrganizationRuleEvaluationReason;
}): void {
    organizationRuleEvaluator?.(input);
}

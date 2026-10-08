type OrganizationRuleEvaluationReason = 'scope_changed' | 'startup';

export interface OrganizationRuleEvaluationRequest {
    organizationId: string;
    reason: OrganizationRuleEvaluationReason;
    /** Devices whose access changed. Absent means re-check the whole org. */
    externalIds?: readonly string[];
}

type OrganizationRuleEvaluator = (
    input: OrganizationRuleEvaluationRequest
) => void;

let organizationRuleEvaluator: OrganizationRuleEvaluator | null = null;

export function registerOrganizationRuleEvaluator(
    evaluator: OrganizationRuleEvaluator
): void {
    organizationRuleEvaluator = evaluator;
}

export function scheduleOrganizationRuleEvaluation(
    input: OrganizationRuleEvaluationRequest
): void {
    organizationRuleEvaluator?.(input);
}

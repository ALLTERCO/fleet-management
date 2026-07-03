import {labelMatchersMatch, resourceSelectorsMatch} from './matchers';
import type {StoredRoutingPolicy} from './RoutingPolicyStore';

export interface RoutingEvaluationInput {
    policies: StoredRoutingPolicy[];
    severity: string;
    labels: Record<string, string>;
    resource?: {
        type: string;
        id: string;
    };
}

export interface RoutingEvaluationMatch {
    policyId: number;
    name: string;
    contactPoints: unknown[];
    groupingKeys: string[];
    muteWindows: unknown[];
    runtimeSilences: unknown[];
    inhibitionRules: unknown[];
    escalationStages: unknown[];
}

export function evaluateRoutingPolicies(
    input: RoutingEvaluationInput
): RoutingEvaluationMatch[] {
    return orderedEnabledPolicies(input.policies)
        .filter((policy) => policyMatches(policy, input))
        .map(policyToMatch);
}

function orderedEnabledPolicies(
    policies: StoredRoutingPolicy[]
): StoredRoutingPolicy[] {
    return policies
        .filter((policy) => policy.enabled)
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

function policyMatches(
    policy: StoredRoutingPolicy,
    input: RoutingEvaluationInput
): boolean {
    return (
        severityMatches(policy.severityMatchers, input.severity) &&
        labelMatchersMatch(policy.labelMatchers, input.labels) &&
        resourceSelectorsMatch(policy.resourceSelectors, input.resource)
    );
}

function severityMatches(matchers: string[], severity: string): boolean {
    return matchers.length === 0 || matchers.includes(severity);
}

function policyToMatch(policy: StoredRoutingPolicy): RoutingEvaluationMatch {
    return {
        policyId: policy.id,
        name: policy.name,
        contactPoints: policy.contactPoints,
        groupingKeys: policy.groupingKeys,
        muteWindows: policy.muteWindows,
        runtimeSilences: policy.runtimeSilences,
        inhibitionRules: policy.inhibitionRules,
        escalationStages: policy.escalationStages
    };
}

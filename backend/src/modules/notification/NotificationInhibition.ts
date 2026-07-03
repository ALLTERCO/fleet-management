import type {DeliveryPayload} from '../delivery/types';
import {labelMatchersMatch} from './matchers';
import {readObject, readStringArray} from './rowReaders';

export interface InhibitionAlertFact {
    id: number;
    state: DeliveryPayload['state'];
    severity: string;
    labels: Record<string, string>;
}

export interface InhibitionDecision {
    inhibited: boolean;
    sourceAlertId?: number;
}

export function evaluateInhibition(input: {
    target: InhibitionAlertFact;
    sources: InhibitionAlertFact[];
    rules: unknown[];
}): InhibitionDecision {
    if (input.target.state === 'resolved') return {inhibited: false};
    for (const rule of input.rules) {
        const decision = evaluateRule({rule, ...input});
        if (decision.inhibited) return decision;
    }
    return {inhibited: false};
}

function evaluateRule(input: {
    rule: unknown;
    target: InhibitionAlertFact;
    sources: InhibitionAlertFact[];
}): InhibitionDecision {
    const rule = readObject(input.rule);
    if (!targetMatchesRule(input.target, rule)) return {inhibited: false};
    const source = input.sources.find((candidate) =>
        sourceInhibitsTarget({source: candidate, target: input.target, rule})
    );
    return source
        ? {inhibited: true, sourceAlertId: source.id}
        : {inhibited: false};
}

function targetMatchesRule(
    target: InhibitionAlertFact,
    rule: Record<string, unknown>
): boolean {
    return (
        severityAllowed(target.severity, rule.targetSeverities) &&
        labelMatchersMatch(readMatchers(rule.targetMatchers), target.labels)
    );
}

function sourceInhibitsTarget(input: {
    source: InhibitionAlertFact;
    target: InhibitionAlertFact;
    rule: Record<string, unknown>;
}): boolean {
    if (input.source.id === input.target.id) return false;
    if (!['active', 'acknowledged'].includes(input.source.state)) return false;
    if (!severityAllowed(input.source.severity, input.rule.sourceSeverities)) {
        return false;
    }
    if (
        !labelMatchersMatch(
            readMatchers(input.rule.sourceMatchers),
            input.source.labels
        )
    ) {
        return false;
    }
    return equalLabelsMatch({
        labels: readEqualLabels(input.rule),
        source: input.source.labels,
        target: input.target.labels
    });
}

function severityAllowed(severity: string, raw: unknown): boolean {
    const allowed = readStringArray(raw);
    return allowed.length === 0 || allowed.includes(severity);
}

function readMatchers(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function readEqualLabels(rule: Record<string, unknown>): string[] {
    return readStringArray(rule.equalLabels ?? rule.equal);
}

function equalLabelsMatch(input: {
    labels: string[];
    source: Record<string, string>;
    target: Record<string, string>;
}): boolean {
    return input.labels.every(
        (label) => input.source[label] === input.target[label]
    );
}

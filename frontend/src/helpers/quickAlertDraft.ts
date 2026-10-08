// The quick alert path: pick a ready-made alert, say which devices, say who
// to tell. Three decisions, and two of them are the only ones a built-in
// template cannot answer for you.
//
// A template already carries the trigger, the condition, the severity, the
// timers and both message bodies. It carries no scope — and an empty scope
// means every device in the organisation, so leaving it blank silently makes
// a fleet-wide rule. It carries no destination either. Those two are the
// whole of the quick flow.

import type {
    AlertRuleTemplate,
    ScopeSelector as AlertScopeSelector,
    AlertScopeType
} from '@api/alert';
import {describeRuleKind} from '@/helpers/ruleKinds';
import type {WizardStepDef} from '@/helpers/wizardFlow';

export interface QuickAlertDraft {
    template: AlertRuleTemplate | null;
    name: string;
    scope: AlertScopeSelector;
    channelIds: number[];
    groupIds: number[];
}

export interface QuickAlertPayload {
    templateKey: string;
    name: string;
    scope: AlertScopeSelector;
    destinationChannelIds: number[];
    destinationGroupIds: number[];
}

export const QUICK_ALERT_STEP_IDS = ['alert', 'devices', 'notify'] as const;

type ExecutableAlertRuleTemplate = AlertRuleTemplate & {
    available: true;
    kind: NonNullable<AlertRuleTemplate['kind']>;
};

export function isExecutableAlertTemplate(
    template: AlertRuleTemplate | null
): template is ExecutableAlertRuleTemplate {
    return template?.available === true && template.kind !== null;
}

export function createQuickAlertDraft(): QuickAlertDraft {
    return {
        template: null,
        name: '',
        scope: {},
        channelIds: [],
        groupIds: []
    };
}

const EVERY_SCOPE_TYPE: readonly AlertScopeType[] = [
    'device',
    'group',
    'location',
    'tag'
];

/** The scope types the picked alert's kind accepts. The backend rejects a
 *  scope type its kind does not list, so the picker offers only those. */
export function quickAlertScopeTypes(
    template: AlertRuleTemplate | null
): AlertScopeType[] {
    if (!template) return [...EVERY_SCOPE_TYPE];
    if (!isExecutableAlertTemplate(template)) return [];
    return [...describeRuleKind(template.kind).supportedScopeTypes];
}

/** How many subjects the scope names. Zero means the whole fleet. */
export function countScopedSubjects(scope: AlertScopeSelector): number {
    return (
        (scope.deviceIds?.length ?? 0) +
        (scope.componentIds?.length ?? 0) +
        (scope.groupIds?.length ?? 0) +
        (scope.locationIds?.length ?? 0) +
        (scope.tagIds?.length ?? 0)
    );
}

/** A named scope, or the honest words for the empty one. */
export function describeScope(scope: AlertScopeSelector): string {
    const count = countScopedSubjects(scope);
    if (count === 0) return 'Every device';
    return count === 1 ? '1 device' : `${count} devices`;
}

export function describeRecipients(draft: QuickAlertDraft): string {
    const count = draft.channelIds.length + draft.groupIds.length;
    if (count === 0) return '';
    return count === 1 ? '1 destination' : `${count} destinations`;
}

export function hasRecipient(draft: QuickAlertDraft): boolean {
    return draft.channelIds.length + draft.groupIds.length > 0;
}

/**
 * The strip along the footer, reading as the alert being built.
 *
 * The devices step counts as answered even with nothing picked: an empty scope
 * is a legitimate fleet-wide rule, and the segment says "Every device" so the
 * choice is never silent.
 */
export function quickAlertSteps(draft: QuickAlertDraft): WizardStepDef[] {
    return [
        {
            id: 'alert',
            label: 'Which alert',
            complete: isExecutableAlertTemplate(draft.template),
            summary: draft.template?.label
        },
        {
            id: 'devices',
            label: 'Which devices',
            complete: isExecutableAlertTemplate(draft.template),
            summary: describeScope(draft.scope)
        },
        {
            id: 'notify',
            label: 'Who to tell',
            complete: hasRecipient(draft),
            summary: describeRecipients(draft)
        }
    ];
}

/**
 * The create payload, or null when the draft is not finishable.
 *
 * The name falls back to the template's own label, which is what a person
 * would have typed anyway — one less box between them and a working alert.
 */
export function buildQuickAlertPayload(
    draft: QuickAlertDraft
): QuickAlertPayload | null {
    if (!isExecutableAlertTemplate(draft.template) || !hasRecipient(draft)) {
        return null;
    }
    return {
        templateKey: draft.template.templateKey,
        name: draft.name.trim() || draft.template.label,
        scope: draft.scope,
        destinationChannelIds: [...draft.channelIds],
        destinationGroupIds: [...draft.groupIds]
    };
}

import {
    ALERT_RULE_KIND_DESCRIPTOR_BY_KEY,
    type AlertRuleKind,
    type AlertSourceRef,
    type AlertState
} from '../types/api/alert';
import type {
    InboxState,
    NotificationInboxAction
} from '../types/api/notification';

interface DeriveInboxAvailableActionsParams {
    state: InboxState;
    source: AlertSourceRef | null;
    alertState: AlertState | null;
    alertKind: AlertRuleKind | null;
    silencedUntil: string | null;
    storedAvailableActions?: string[] | null;
}

function asCandidateSet(
    storedAvailableActions?: string[] | null
): Set<string> | null {
    if (!storedAvailableActions || storedAvailableActions.length === 0) {
        return null;
    }

    return new Set(storedAvailableActions);
}

function isAllowedByCandidate(
    action: NotificationInboxAction,
    candidates: Set<string> | null
): boolean {
    return candidates === null || candidates.has(action);
}

export function supportsManualResolve(kind: AlertRuleKind | null): boolean {
    if (!kind) return false;
    return (
        ALERT_RULE_KIND_DESCRIPTOR_BY_KEY[kind]?.supportsManualResolve === true
    );
}

export function hasActiveSilence(silencedUntil: string | null): boolean {
    if (!silencedUntil) return false;
    const ts = new Date(silencedUntil).getTime();
    return Number.isFinite(ts) && ts > Date.now();
}

export function deriveInboxAvailableActions(
    params: DeriveInboxAvailableActionsParams
): NotificationInboxAction[] {
    const actions: NotificationInboxAction[] = [];
    const candidates = asCandidateSet(params.storedAvailableActions);

    actions.push(params.state === 'read' ? 'mark_unread' : 'mark_read');

    if (params.alertState && params.alertState !== 'resolved') {
        if (params.alertState === 'active') {
            if (isAllowedByCandidate('acknowledge_alert', candidates)) {
                actions.push('acknowledge_alert');
            }
        } else if (isAllowedByCandidate('unacknowledge_alert', candidates)) {
            actions.push('unacknowledge_alert');
        }

        if (hasActiveSilence(params.silencedUntil)) {
            if (isAllowedByCandidate('unsilence_alert', candidates)) {
                actions.push('unsilence_alert');
            }
        } else if (isAllowedByCandidate('silence_alert', candidates)) {
            actions.push('silence_alert');
        }
    }

    if (params.source && isAllowedByCandidate('open_source', candidates)) {
        actions.push('open_source');
    }

    return actions;
}

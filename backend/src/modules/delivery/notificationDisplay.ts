// Single source of truth for severity/state display across all delivery
// adapters (email, telegram, teams, slack). Every value is env-overridable.
// See docs/env-reference.md § Notification display.

import {envStr} from '../../config/envReader';
import type {DeliveryPayload} from './types';

type Severity = DeliveryPayload['severity'];
type State = DeliveryPayload['state'];

const SEVERITY_EMOJI_DEFAULTS: Record<Severity, string> = {
    critical: '🔴',
    warning: '🟡',
    info: '🔵'
};

const SEVERITY_COLOR_DEFAULTS: Record<Severity, string> = {
    critical: '#dc2626',
    warning: '#d97706',
    info: '#2563eb'
};

const STATE_EMOJI_DEFAULTS: Record<State, string> = {
    pending: '⏳',
    active: '',
    acknowledged: '✅',
    recovering: '🟢',
    cleared_unack: '🟢',
    cleared_ack: '✅',
    no_data: '⚪',
    evaluation_error: '⚠️',
    resolved: '✔️'
};

const STATE_LABEL_DEFAULTS: Record<State, string> = {
    pending: 'pending',
    active: 'active',
    acknowledged: 'acknowledged',
    recovering: 'recovering',
    cleared_unack: 'cleared',
    cleared_ack: 'cleared and acknowledged',
    no_data: 'no data',
    evaluation_error: 'evaluation error',
    resolved: 'resolved'
};

// Slack flavor — kept separate so operators can toggle shortcode vs
// Unicode emoji per-provider without losing Slack's iconic rendering.
const SLACK_SEVERITY_EMOJI_DEFAULTS: Record<Severity, string> = {
    critical: ':rotating_light:',
    warning: ':warning:',
    info: ':information_source:'
};

export function severityEmoji(severity: Severity): string {
    return envStr(
        `FM_NOTIFICATION_SEVERITY_EMOJI_${severity.toUpperCase()}`,
        SEVERITY_EMOJI_DEFAULTS[severity]
    );
}

export function severityLabel(severity: Severity): string {
    return severity.toUpperCase();
}

export function severityColor(severity: Severity): string {
    return envStr(
        `FM_NOTIFICATION_SEVERITY_COLOR_${severity.toUpperCase()}`,
        SEVERITY_COLOR_DEFAULTS[severity]
    );
}

export function stateEmoji(state: State): string {
    return envStr(
        `FM_NOTIFICATION_STATE_EMOJI_${state.toUpperCase()}`,
        STATE_EMOJI_DEFAULTS[state]
    );
}

export function stateLabel(state: State): string {
    return envStr(
        `FM_NOTIFICATION_STATE_LABEL_${state.toUpperCase()}`,
        STATE_LABEL_DEFAULTS[state]
    );
}

// Combined "emoji label" for inline banners. Returns '' when state=active.
export function stateBadge(state: State): string {
    if (state === 'active') return '';
    const emoji = stateEmoji(state);
    const label = stateLabel(state);
    return `${emoji} ${label}`.trim();
}

export function slackSeverityEmoji(severity: Severity): string {
    return envStr(
        `FM_NOTIFICATION_SLACK_SEVERITY_EMOJI_${severity.toUpperCase()}`,
        SLACK_SEVERITY_EMOJI_DEFAULTS[severity]
    );
}

export function notificationDisplayContext(
    severity: Severity,
    state: State
): Record<string, string> {
    return {
        severityLabel: severityLabel(severity),
        severityEmoji: severityEmoji(severity),
        severityColor: severityColor(severity),
        stateLabel: stateLabel(state),
        stateEmoji: stateEmoji(state),
        stateBadge: stateBadge(state),
        slackSeverityEmoji: slackSeverityEmoji(severity)
    };
}

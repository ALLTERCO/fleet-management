// Single source of truth for severity/state display across all delivery
// adapters (email, telegram, teams, slack). Every value is env-overridable.
// See docs/public/reference/env-reference.md § Notification display.

import {envStr} from '../../config/envReader';
import {NOTIFICATION_BRAND} from '../notification/brand';
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
    info: NOTIFICATION_BRAND.shellyBlue
};

const STATE_EMOJI_DEFAULTS: Record<State, string> = {
    pending: '⏳',
    active: '●',
    acknowledged: '✅',
    recovering: '🟢',
    cleared_unack: '🟢',
    cleared_ack: '✅',
    no_data: '⚪',
    evaluation_error: '⚠️',
    resolved: '✔️'
};

const STATE_LABEL_DEFAULTS: Record<State, string> = {
    pending: 'Pending',
    active: 'Active',
    acknowledged: 'Acknowledged',
    recovering: 'Recovering',
    cleared_unack: 'Cleared',
    cleared_ack: 'Cleared and acknowledged',
    no_data: 'No data',
    evaluation_error: 'Evaluation error',
    resolved: 'Resolved'
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

// Combined emoji and label for compact provider status rows.
export function stateBadge(state: State): string {
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

export function notificationTimeLabel(
    value: string,
    timeZone = 'UTC',
    locale = 'en-US'
): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const parts = new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone,
        timeZoneName: 'short'
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((entry) => entry.type === type)?.value ?? '';
    return `${part('day')} ${part('month')} ${part('year')} · ${part('hour')}:${part('minute')} ${part('timeZoneName')}`;
}

export function notificationDisplayContext(
    severity: Severity,
    state: State
): Record<string, string> {
    const resolved = state === 'resolved';
    const active = state === 'active';
    return {
        severityLabel: severityLabel(severity),
        severityEmoji: severityEmoji(severity),
        severityColor: severityColor(severity),
        stateLabel: stateLabel(state),
        stateEmoji: stateEmoji(state),
        stateColor: resolved
            ? NOTIFICATION_BRAND.resolvedGreen
            : NOTIFICATION_BRAND.mediumBlue,
        stateBackground: active
            ? NOTIFICATION_BRAND.mediumBlue
            : resolved
              ? NOTIFICATION_BRAND.resolvedGreen
              : NOTIFICATION_BRAND.white,
        stateBorderColor: resolved
            ? NOTIFICATION_BRAND.resolvedGreen
            : NOTIFICATION_BRAND.shellyBlue,
        stateTextColor: active
            ? NOTIFICATION_BRAND.white
            : resolved
              ? NOTIFICATION_BRAND.darkBlue
              : NOTIFICATION_BRAND.mediumBlue,
        stateIconColor: active
            ? NOTIFICATION_BRAND.white
            : resolved
              ? NOTIFICATION_BRAND.darkBlue
              : NOTIFICATION_BRAND.mediumBlue,
        stateTeamsColor: resolved ? 'Good' : 'Default',
        stateBadge: stateBadge(state),
        slackSeverityEmoji: slackSeverityEmoji(severity)
    };
}

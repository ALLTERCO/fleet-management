// What actually gets saved when an alert rule is written.
//
// Pulled out of EditAlertRuleModal so these decisions can be read and tested
// on their own: which timer values are refused, when a digest window counts,
// and when active hours are sent at all. Everything here is pure — creating a
// message template is a side effect and stays with the caller, which is why
// `templateId` and `messageTemplate` arrive already resolved.

import type {AlertSeverity, ScopeSelector} from '@api/alert';

export type AlertDeliveryMode = 'instant' | 'digest';

export interface AlertRuleActiveWindow {
    startTime: string;
    endTime: string;
    daysMask: number;
}

/** The form's answers, flattened. Refs belong to the component, not here. */
export interface AlertRuleDraft {
    name: string;
    enabled: boolean;
    /** Empty means the form has not answered yet, which blocks the save. */
    severity: AlertSeverity | '';
    scope: ScopeSelector;
    destinationChannelIds: number[];
    destinationGroupIds: number[];
    dedupeWindowSec: number;
    cooldownSec: number;
    summaryTemplate: string;
    messageTemplate: string;
    runbookUrl: string;
    templateId: number | null;
    autoResolve: boolean;
    triggerOnce: boolean;
    config: Record<string, unknown>;
    deliveryMode: AlertDeliveryMode;
    /** Straight from the input, so "2.5" and "soon" both have to be handled. */
    digestWindowRaw: string;
    activeWindow: AlertRuleActiveWindow | null;
}

export interface AlertRuleTimings {
    dedupeWindowSec: number;
    cooldownSec: number;
}

/** Answer: is this a usable number of seconds? */
export function normalizeSec(value: number): number | null {
    return Number.isInteger(value) && value >= 0 ? value : null;
}

/** Both timers, or nothing — a rule with one half-set window is not savable. */
export function parseTimings(
    dedupeWindowSec: number,
    cooldownSec: number
): AlertRuleTimings | null {
    const dedupe = normalizeSec(dedupeWindowSec);
    const cooldown = normalizeSec(cooldownSec);
    if (dedupe == null || cooldown == null) return null;
    return {dedupeWindowSec: dedupe, cooldownSec: cooldown};
}

/**
 * Answer: how many minutes of alerts to gather before sending, if any.
 *
 * The box keeps its value when someone switches back to instant, so the
 * delivery mode decides whether it counts — not whether it is filled in.
 */
export function digestWindowMinutes(
    mode: AlertDeliveryMode,
    raw: string
): number | null {
    if (mode !== 'digest') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const minutes = Number(trimmed);
    if (!Number.isInteger(minutes) || minutes < 1) return null;
    return minutes;
}

// An empty box means "no override", which the backend reads as null. Sending
// an empty string instead would store a blank template and render nothing.
function textOrNull(value: string): string | null {
    return value.trim() || null;
}

/** The save payload, or null when the draft cannot be saved as it stands. */
export function buildAlertRulePayload(draft: AlertRuleDraft) {
    const timings = parseTimings(draft.dedupeWindowSec, draft.cooldownSec);
    if (!timings) return null;
    if (!draft.severity) return null;

    return {
        name: draft.name.trim(),
        enabled: draft.enabled,
        severity: draft.severity,
        scope: draft.scope,
        destinationChannelIds: draft.destinationChannelIds,
        destinationGroupIds: draft.destinationGroupIds,
        dedupeWindowSec: timings.dedupeWindowSec,
        cooldownSec: timings.cooldownSec,
        summaryTemplate: textOrNull(draft.summaryTemplate),
        // A stored template supersedes the inline body; sending both would
        // leave two sources for one message.
        messageTemplate: draft.templateId
            ? null
            : textOrNull(draft.messageTemplate),
        runbookUrl: textOrNull(draft.runbookUrl),
        templateId: draft.templateId,
        autoResolve: draft.autoResolve,
        triggerOnce: draft.triggerOnce,
        // Copied, so a later edit to the form cannot reach a built payload.
        config: {...draft.config},
        deliveryMode: draft.deliveryMode,
        digestWindowMinutes: digestWindowMinutes(
            draft.deliveryMode,
            draft.digestWindowRaw
        ),
        activeWindow: draft.activeWindow
            ? {
                  ...draft.activeWindow,
                  // The browser's zone is the one the operator typed against.
                  timezone:
                      Intl.DateTimeFormat().resolvedOptions().timeZone || null
              }
            : null
    };
}

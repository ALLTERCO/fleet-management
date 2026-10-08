// The alert rule being edited, as the form holds it.
//
// Lifted out of EditAlertRuleModal, where twenty-two refs and the rules for
// loading a stored rule into them shared a file with the picker, the payload
// builder and the save path. Loading is where the defaults live — what an
// absent field becomes, and what gets copied rather than shared — and none of
// it could be checked without mounting the whole modal.
//
// The refs are returned individually rather than as one bag so the form can
// keep binding them straight to controls.

import type {
    AlertRule,
    AlertRuleKind,
    AlertSeverity,
    ScopeSelector
} from '@api/alert';
import {ref} from 'vue';

/** Every day selected — the mask an active window starts from. */
export const ALL_DAYS = 0b1111111;

const DEFAULT_WINDOW_START = '02:00';
const DEFAULT_WINDOW_END = '05:00';

export function useAlertRuleForm() {
    const kind = ref<AlertRuleKind | null>(null);
    const name = ref('');
    const enabled = ref(true);
    const autoResolve = ref(false);
    const triggerOnce = ref(false);
    const severity = ref<AlertSeverity | ''>('info');
    const scope = ref<ScopeSelector>({});
    const config = ref<Record<string, unknown>>({});
    const destinationChannelIds = ref<number[]>([]);
    const destinationGroupIds = ref<number[]>([]);
    const dedupeWindowSec = ref(0);
    const cooldownSec = ref(0);
    const deliveryMode = ref<'instant' | 'digest'>('instant');
    const digestWindow = ref('');
    const activeWindowOn = ref(false);
    const activeWindowStart = ref(DEFAULT_WINDOW_START);
    const activeWindowEnd = ref(DEFAULT_WINDOW_END);
    const activeWindowDays = ref(ALL_DAYS);
    const summaryTemplate = ref('');
    const messageTemplate = ref('');
    const runbookUrl = ref('');
    const templateId = ref<number | null>(null);

    // A saved window is one object; the form edits it as four controls.
    function loadActiveWindow(rule: AlertRule | null | undefined): void {
        const win = rule?.activeWindow ?? null;
        activeWindowOn.value = win !== null;
        activeWindowStart.value = win?.startTime ?? DEFAULT_WINDOW_START;
        activeWindowEnd.value = win?.endTime ?? DEFAULT_WINDOW_END;
        activeWindowDays.value = win?.daysMask ?? ALL_DAYS;
    }

    /**
     * Load a stored rule, or clear to the defaults a new rule starts from.
     *
     * Objects and arrays are copied. Editing the form must not reach back into
     * the rule it was opened from, or cancelling would keep the change anyway.
     */
    function reset(rule: AlertRule | null | undefined): void {
        kind.value = rule?.kind ?? null;
        name.value = rule?.name ?? '';
        enabled.value = rule?.enabled ?? true;
        autoResolve.value = rule?.autoResolve ?? false;
        // Absent means a rule saved before the field existed: it repeats.
        triggerOnce.value = rule?.triggerOnce === true;
        severity.value = (rule?.severity ?? 'info') as AlertSeverity;
        scope.value = rule?.scope ? {...rule.scope} : {};
        config.value = rule ? {...rule.config} : {};
        destinationChannelIds.value = [...(rule?.destinationChannelIds ?? [])];
        destinationGroupIds.value = [...(rule?.destinationGroupIds ?? [])];
        dedupeWindowSec.value = rule?.dedupeWindowSec ?? 0;
        cooldownSec.value = rule?.cooldownSec ?? 0;
        deliveryMode.value =
            rule?.deliveryMode === 'digest' ? 'digest' : 'instant';
        digestWindow.value =
            rule?.digestWindowMinutes != null
                ? String(rule.digestWindowMinutes)
                : '';
        loadActiveWindow(rule);
        summaryTemplate.value = rule?.summaryTemplate ?? '';
        messageTemplate.value = rule?.messageTemplate ?? '';
        runbookUrl.value = rule?.runbookUrl ?? '';
        templateId.value = rule?.templateId ?? null;
    }

    return {
        kind,
        name,
        enabled,
        autoResolve,
        triggerOnce,
        severity,
        scope,
        config,
        destinationChannelIds,
        destinationGroupIds,
        dedupeWindowSec,
        cooldownSec,
        deliveryMode,
        digestWindow,
        activeWindowOn,
        activeWindowStart,
        activeWindowEnd,
        activeWindowDays,
        summaryTemplate,
        messageTemplate,
        runbookUrl,
        templateId,
        reset
    };
}

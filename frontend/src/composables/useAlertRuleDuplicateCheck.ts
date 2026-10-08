// Warns when the rule being drafted already exists. The draft changes on every
// keystroke, so the check is debounced and never outlives the form.

import type {AlertRuleKind, AlertSeverity, ScopeSelector} from '@api/alert';
import {
    computed,
    type ComputedRef,
    type MaybeRefOrGetter,
    onScopeDispose,
    ref,
    toValue,
    watch
} from 'vue';
import {UI_CONFIG} from '@/config/ui';
import {useAlertsStore} from '@/stores/alerts';

/** An existing rule that covers the same ground as the draft. */
export interface DuplicateRule {
    id: number;
    name: string;
}

/** Discriminated so a failed check never reads as "no duplicate". */
export type DuplicateCheckResult =
    | {status: 'ok'; duplicate: DuplicateRule | null}
    | {status: 'error'};

/** A draft complete enough to ask the backend about. */
export interface DuplicateCheckSpec {
    kind: AlertRuleKind;
    severity: AlertSeverity;
    scope: ScopeSelector;
    config: Record<string, unknown>;
    dedupeWindowSec: number;
    cooldownSec: number;
    excludeId?: number;
}

/** Only the fields a duplicate comparison looks at. The full save draft is
 *  `DuplicateCheckDraft` in helpers/alertRulePayload — a different, larger thing. */
export interface DuplicateCheckDraft {
    kind: AlertRuleKind | null;
    severity: AlertSeverity | '';
    scope: ScopeSelector;
    config: Record<string, unknown>;
    dedupeWindowSec: number;
    cooldownSec: number;
}

/** The only store call this needs — tests pass a stub instead of Pinia. */
export interface DuplicateCheckPort {
    checkDuplicate(spec: DuplicateCheckSpec): Promise<DuplicateCheckResult>;
}

export interface UseAlertRuleDuplicateCheckOptions {
    draft: MaybeRefOrGetter<DuplicateCheckDraft>;
    /** The rule being edited — a rule is not its own duplicate. */
    excludeId?: MaybeRefOrGetter<number | null | undefined>;
    store?: DuplicateCheckPort;
    debounceMs?: number;
}

export interface AlertRuleDuplicateCheck {
    duplicate: ComputedRef<DuplicateRule | null>;
    clear: () => void;
}

/** Answer: the spec to ask about, or null while the draft says too little. */
export function duplicateCheckSpecFor(
    draft: DuplicateCheckDraft,
    excludeId?: number | null
): DuplicateCheckSpec | null {
    if (!draft.kind || !draft.severity) return null;
    return {
        kind: draft.kind,
        severity: draft.severity,
        scope: draft.scope,
        config: draft.config,
        dedupeWindowSec: draft.dedupeWindowSec,
        cooldownSec: draft.cooldownSec,
        ...(excludeId == null ? {} : {excludeId})
    };
}

/** Answer: the rule to warn about. A check that failed warns about nothing. */
export function duplicateFromResult(
    result: DuplicateCheckResult
): DuplicateRule | null {
    return result.status === 'ok' ? result.duplicate : null;
}

export function useAlertRuleDuplicateCheck(
    options: UseAlertRuleDuplicateCheckOptions
): AlertRuleDuplicateCheck {
    const store = options.store ?? useAlertsStore();
    const debounceMs = options.debounceMs ?? UI_CONFIG.duplicateCheckDebounceMs;

    const found = ref<DuplicateRule | null>(null);
    let pendingTimer: ReturnType<typeof setTimeout> | undefined;
    // Bumped on every cancel so a reply that is already in flight is ignored.
    let generation = 0;

    function cancelPending(): void {
        clearTimeout(pendingTimer);
        pendingTimer = undefined;
        generation += 1;
    }

    function clear(): void {
        cancelPending();
        found.value = null;
    }

    function schedule(spec: DuplicateCheckSpec): void {
        cancelPending();
        pendingTimer = setTimeout(() => void askStore(spec), debounceMs);
    }

    // No try/catch: a swallowed failure here would show as "no duplicate".
    async function askStore(spec: DuplicateCheckSpec): Promise<void> {
        const asked = generation;
        const result = await store.checkDuplicate(spec);
        if (asked !== generation) return;
        found.value = duplicateFromResult(result);
    }

    watch(
        () => toValue(options.draft),
        (draft) => {
            const spec = duplicateCheckSpecFor(
                draft,
                toValue(options.excludeId)
            );
            if (!spec) {
                clear();
                return;
            }
            schedule(spec);
        },
        {deep: true}
    );

    // WHY: if the form goes away during the debounce window, the pending
    // duplicate-check would hit the network pointlessly and set state on a
    // dead component.
    onScopeDispose(cancelPending);

    return {duplicate: computed(() => found.value), clear};
}

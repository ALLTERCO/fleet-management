// The component-path picker: the signal list a component rule points at.
//
// The rule kind decides which signal shape is offered, the rule's scope decides
// whose signals are listed, and clicking one writes it into the rule's
// condition. The decisions below are pure so they can be trusted without a
// component; the composable at the bottom is only the wiring around them.

import type {AlertComponentPath, AlertRuleKind} from '@api/alert';
import {computed, type MaybeRefOrGetter, type Ref, ref, toValue, watch} from 'vue';
import {
    describeSignalSource,
    explainNoSignals,
    filterSignals,
    groupSignalsByDevice,
    type ScopedComponentPath,
    scopeKeyOf,
    tagPathsWithDevice
} from '@/helpers/alertSignalPicker';
import {getDeviceName} from '@/helpers/device';
import {useAlertsStore} from '@/stores/alerts';
import {useDevicesStore} from '@/stores/devices';

/** Signal shape a rule kind watches. */
export type SignalKind = 'metric' | 'state';

/** The grid renders at most this many; the rest is reported, never dropped. */
export const SIGNAL_GRID_LIMIT = 32;

/** What the grid shows, and how many matches it had to leave out. */
export interface CappedSignals {
    shown: ScopedComponentPath[];
    hidden: number;
}

const SIGNAL_KIND_BY_RULE: Partial<Record<AlertRuleKind, SignalKind>> = {
    component_threshold: 'metric',
    component_state: 'state'
};

/** The signal shape a rule kind can watch; null when it watches none. */
export function signalKindFor(
    ruleKind: AlertRuleKind | null | undefined
): SignalKind | null {
    if (!ruleKind) return null;
    return SIGNAL_KIND_BY_RULE[ruleKind] ?? null;
}

/** Keeps the cap honest: 32 signals shown in total, not 32 per device. */
export function capSignals(
    signals: readonly ScopedComponentPath[],
    limit: number
): CappedSignals {
    const shown = signals.slice(0, limit);
    return {shown, hidden: signals.length - shown.length};
}

/** Component families the catalog covers, so `switch:0` reads as `switch`. */
export function componentFamilies(
    signals: readonly AlertComponentPath[]
): ReadonlySet<string> {
    const families = new Set<string>();
    for (const signal of signals) {
        const family = signal.component.split(':')[0];
        if (family) families.add(family);
    }
    return families;
}

/** The condition's signal as `component.field`, or empty when none is set. */
export function describeChosenSignal(
    condition: Readonly<Record<string, unknown>>
): string {
    const {component, field} = condition;
    if (typeof component !== 'string' || !component) return '';
    return typeof field === 'string' && field
        ? `${component}.${field}`
        : component;
}

/** Whether the condition already points at this signal. */
export function conditionTargets(
    condition: Readonly<Record<string, unknown>>,
    signal: AlertComponentPath
): boolean {
    return (
        condition.component === signal.component &&
        condition.field === signal.field
    );
}

/** The state a rule waits for by default — open/on over the first listed value. */
export function defaultStateValue(
    signal: AlertComponentPath
): string | number | boolean {
    if (signal.values?.includes(true)) return true;
    return signal.values?.[0] ?? true;
}

/**
 * The condition repointed at a signal. A metric keeps whatever comparison the
 * user already set, so switching signals never silently resets the threshold.
 */
export function conditionWithSignal(
    condition: Readonly<Record<string, unknown>>,
    signal: AlertComponentPath
): Record<string, unknown> {
    const target = {
        ...condition,
        component: signal.component,
        field: signal.field
    };
    if (signal.kind !== 'metric') {
        return {...target, equals: defaultStateValue(signal)};
    }
    return {
        ...target,
        operator: condition.operator ?? 'gt',
        threshold: condition.threshold ?? 0
    };
}

export interface ComponentPathPickerInput {
    /** Devices the rule names; empty lists the whole fleet. */
    deviceIds: MaybeRefOrGetter<readonly string[]>;
    /** The rule kind being edited; decides which signals are offered. */
    ruleKind: MaybeRefOrGetter<AlertRuleKind | null>;
    /** The rule's condition. Choosing a signal rewrites it. */
    condition: Ref<Record<string, unknown>>;
    /** Reloads on scope change only while the editor is on screen. */
    active: MaybeRefOrGetter<boolean>;
}

export function useComponentPathPicker(input: ComponentPathPickerInput) {
    const alerts = useAlertsStore();
    const devices = useDevicesStore();

    const catalog = ref<ScopedComponentPath[]>([]);
    const loading = ref(false);
    const search = ref('');
    // A fast scope change must not let the earlier response win the race.
    let newestLoad = 0;

    const deviceIds = computed(() => toValue(input.deviceIds));
    const wantedKind = computed(() => signalKindFor(toValue(input.ruleKind)));

    function deviceLabel(shellyID: string): string {
        return getDeviceName(devices.devices[shellyID]?.info, shellyID);
    }

    async function signalsOfDevice(
        shellyID: string
    ): Promise<ScopedComponentPath[]> {
        const paths = await alerts.listComponentPaths(shellyID);
        return tagPathsWithDevice(paths, {
            id: shellyID,
            name: deviceLabel(shellyID)
        });
    }

    /** The catalog RPC answers per device, so a scoped rule asks once each. */
    async function readCatalog(
        shellyIDs: readonly string[]
    ): Promise<ScopedComponentPath[]> {
        if (shellyIDs.length === 0) return alerts.listComponentPaths();
        const perDevice = await Promise.all(shellyIDs.map(signalsOfDevice));
        return perDevice.flat();
    }

    /**
     * The signal list follows the scope. Name devices and you see what those
     * devices report; name none and it stays fleet-wide, so a broad rule is
     * still buildable.
     */
    async function reload(): Promise<void> {
        const token = ++newestLoad;
        loading.value = true;
        try {
            const loaded = await readCatalog(deviceIds.value);
            if (token !== newestLoad) return;
            catalog.value = loaded;
        } finally {
            if (token === newestLoad) loading.value = false;
        }
    }

    // A stable set key: ScopeSelector re-emits its model on unrelated edits.
    watch(
        () => scopeKeyOf(deviceIds.value),
        () => {
            if (!toValue(input.active)) return;
            void reload();
        }
    );

    const matches = computed(() =>
        filterSignals(catalog.value, {
            kind: wantedKind.value,
            search: search.value
        })
    );

    const capped = computed(() => capSignals(matches.value, SIGNAL_GRID_LIMIT));

    function isChosen(signal: AlertComponentPath): boolean {
        return conditionTargets(input.condition.value, signal);
    }

    function choose(signal: AlertComponentPath): void {
        input.condition.value = conditionWithSignal(
            input.condition.value,
            signal
        );
    }

    return {
        /** Whether the chosen rule kind watches a signal at all. */
        applies: computed(() => wantedKind.value !== null),
        loading,
        search,
        groups: computed(() => groupSignalsByDevice(capped.value.shown)),
        matchCount: computed(() => matches.value.length),
        hiddenCount: computed(() => capped.value.hidden),
        /** Families the scoped devices report — shared with the quick-picks. */
        families: computed(() => componentFamilies(catalog.value)),
        emptyText: computed(() =>
            explainNoSignals({
                search: search.value,
                deviceCount: deviceIds.value.length
            })
        ),
        sourceText: computed(() => describeSignalSource(deviceIds.value.length)),
        chosenLabel: computed(() => describeChosenSignal(input.condition.value)),
        isChosen,
        choose,
        reload
    };
}

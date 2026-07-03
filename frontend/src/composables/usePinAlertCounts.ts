import type {AlertInstance, AlertState} from '@api/alert';
import {computed} from 'vue';
import {useAlertsStore} from '@/stores/alerts';

const OPEN_STATES = new Set<AlertState>([
    'active',
    'acknowledged',
    'cleared_unack'
]);

function locationIdFromSource(instance: AlertInstance): number | undefined {
    if (instance.source?.subjectType !== 'location') return undefined;
    const numeric = Number(instance.source.subjectId);
    return Number.isFinite(numeric) ? numeric : undefined;
}

function isOpen(instance: AlertInstance): boolean {
    return OPEN_STATES.has(instance.state);
}

function tallyByLocation(instances: AlertInstance[]): Map<number, number> {
    const counts = new Map<number, number>();
    for (const instance of instances) {
        if (!isOpen(instance)) continue;
        const locationId = locationIdFromSource(instance);
        if (locationId === undefined) continue;
        counts.set(locationId, (counts.get(locationId) ?? 0) + 1);
    }
    return counts;
}

export const __testing = {
    locationIdFromSource,
    isOpen,
    tallyByLocation
};

export function usePinAlertCounts() {
    const alertsStore = useAlertsStore();
    const byLocation = computed<Map<number, number>>(() =>
        tallyByLocation(Object.values(alertsStore.instances))
    );
    return {byLocation};
}

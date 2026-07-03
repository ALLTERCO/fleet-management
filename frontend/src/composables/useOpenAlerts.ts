import type {AlertInstance, AlertSeverity, AlertState} from '@api/alert';
import {computed} from 'vue';
import {useAlertsStore} from '@/stores/alerts';

const OPEN_STATES = new Set<AlertState>([
    'active',
    'acknowledged',
    'cleared_unack'
]);

const SEVERITY_RANK: Record<AlertSeverity, number> = {
    critical: 2,
    warning: 1,
    info: 0
};

function isOpen(instance: AlertInstance): boolean {
    return OPEN_STATES.has(instance.state);
}

function compareInstanceBySeverity(a: AlertInstance, b: AlertInstance): number {
    const severityDelta = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (severityDelta !== 0) return severityDelta;
    return b.activeSince.localeCompare(a.activeSince);
}

function selectOpenInstances(instances: AlertInstance[]): AlertInstance[] {
    return instances.filter(isOpen).sort(compareInstanceBySeverity);
}

function topSeverity(open: AlertInstance[]): AlertSeverity | null {
    if (open.length === 0) return null;
    return open[0].severity;
}

export const __testing = {
    isOpen,
    compareInstanceBySeverity,
    selectOpenInstances,
    topSeverity
};

export function useOpenAlerts() {
    const alertsStore = useAlertsStore();

    const open = computed<AlertInstance[]>(() =>
        selectOpenInstances(Object.values(alertsStore.instances))
    );
    const count = computed(() => open.value.length);
    const severity = computed<AlertSeverity | null>(() =>
        topSeverity(open.value)
    );

    return {open, count, severity};
}

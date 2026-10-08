import type {AlertInstance, AlertTransition} from '@api/alert';
import {computed, type Ref, ref, watch} from 'vue';
import {usePermissions} from '@/composables/usePermissions';
import {describeSystemHealthCheck} from '@/helpers/systemHealthChecks';
import {useAlertsStore} from '@/stores/alerts';
import {useDevicesStore} from '@/stores/devices';
import {useGroupsStore} from '@/stores/groups';
import {useNotificationsStore} from '@/stores/notifications';

const FAILED_JOB_STATES: ReadonlySet<string> = new Set([
    'failed',
    'dead_letter'
]);

// Friendly noun per alert scope type — so the source reads "Device", not "device".
const SCOPE_LABEL: Record<string, string> = {
    device: 'Device',
    group: 'Group',
    component: 'Component',
    location: 'Location',
    tag: 'Tag',
    fleet: 'Fleet',
    organization: 'Organization',
    external: 'External',
    system: 'System'
};

export interface AlertSourceView {
    kind: string;
    icon: string;
    label: string;
    to: string | null;
}

// A system health alert: the product itself is the source, the context
// carries the number and the fix.
export interface SystemHealthView {
    actionLabel: string;
    to: string;
    action: string;
    statLabel: string;
    statValue: string;
}

// Data + actions for a single alert instance. Shared by the /alerts/:id page
// and the popup opened from the list, so both act on one source of truth while
// each renders its own layout.
export function useAlertInstance(instanceId: Ref<number | null>) {
    const store = useAlertsStore();
    const notifications = useNotificationsStore();
    const devicesStore = useDevicesStore();
    const groupsStore = useGroupsStore();
    const {canWrite} = usePermissions();

    const loading = ref(false);
    const silenceVisible = ref(false);

    const instance = computed<AlertInstance | null>(() =>
        instanceId.value != null
            ? (store.instances[instanceId.value] ?? null)
            : null
    );

    // Where the alert fired, resolved to a friendly name + a link where we have
    // one (raw `device:abc123` is meaningless to a human).
    const systemHealth = computed<SystemHealthView | null>(() => {
        const i = instance.value;
        if (i?.ruleKind !== 'system_health') return null;
        const context = (i.context ?? {}) as Record<string, unknown>;
        const view = describeSystemHealthCheck(context.check);
        const value = typeof context.value === 'number' ? context.value : null;
        return {
            actionLabel: view.actionLabel,
            to: view.to,
            action: typeof context.action === 'string' ? context.action : '',
            statLabel: view.unit,
            statValue: value === null ? '' : String(value)
        };
    });

    const source = computed<AlertSourceView | null>(() => {
        const s = instance.value?.source;
        if (!s) return null;
        if (systemHealth.value) {
            return {
                kind: 'System check',
                icon: 'fa-solid fa-heart-pulse',
                label: 'Fleet Manager',
                to: systemHealth.value.to
            };
        }
        const id = s.subjectId;
        if (s.subjectType === 'device') {
            const dev = devicesStore.devices[id];
            return {
                kind: 'Device',
                icon: 'fas fa-microchip',
                label: dev?.info?.name || id,
                to: null
            };
        }
        if (s.subjectType === 'group') {
            const grp = groupsStore.groups[Number(id)];
            return {
                kind: 'Group',
                icon: 'fas fa-layer-group',
                label: grp?.name || `Group #${id}`,
                to: `/organize/groups?preview=${id}`
            };
        }
        return {
            kind: SCOPE_LABEL[s.subjectType] ?? s.subjectType,
            icon: 'fas fa-location-crosshairs',
            label: id,
            to: null
        };
    });

    // The actual device / group object behind the source, so the popup can
    // render the real fleet card instead of a bare label.
    const sourceDevice = computed(() => {
        const s = instance.value?.source;
        return s?.subjectType === 'device'
            ? (devicesStore.devices[s.subjectId] ?? null)
            : null;
    });
    const sourceGroup = computed(() => {
        const s = instance.value?.source;
        return s?.subjectType === 'group'
            ? (groupsStore.groups[Number(s.subjectId)] ?? null)
            : null;
    });

    const timeline = computed<AlertTransition[]>(() =>
        instanceId.value != null
            ? (store.transitions[instanceId.value] ?? [])
            : []
    );

    // Distinct from an empty timeline: true only when the transitions fetch
    // itself failed, so the history section can say so instead of reading
    // as a quiet alert.
    const historyError = computed<boolean>(() =>
        instanceId.value != null
            ? (store.transitionsError[instanceId.value] ?? false)
            : false
    );

    const deliveryJobs = computed(() =>
        instanceId.value == null
            ? []
            : Object.values(notifications.history).filter(
                  (j) => j.alertId === instanceId.value
              )
    );

    const silencedActive = computed(() => {
        const until = instance.value?.silencedUntil;
        if (!until) return false;
        const t = new Date(until).getTime();
        return Number.isFinite(t) && t > Date.now();
    });

    const ageLabel = computed(() => {
        const at = instance.value
            ? new Date(instance.value.lastTriggeredAt).getTime()
            : 0;
        if (!Number.isFinite(at)) return '';
        const diff = Date.now() - at;
        const mins = Math.round(diff / 60_000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.round(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        return `${Math.round(hours / 24)}d ago`;
    });

    // The same instant twice says nothing; show the second time only once
    // the alert has fired again.
    const firedAgain = computed(
        () =>
            !!instance.value &&
            instance.value.lastTriggeredAt !== instance.value.activeSince
    );

    const hasContext = computed(
        () =>
            !!instance.value &&
            Object.keys(instance.value.context ?? {}).length > 0
    );

    const contextPreview = computed(() =>
        instance.value ? JSON.stringify(instance.value.context, null, 2) : ''
    );

    function formatTs(ts: string): string {
        const d = new Date(ts);
        if (Number.isNaN(d.getTime())) return ts;
        return d.toLocaleString();
    }

    async function refresh(): Promise<void> {
        const id = instanceId.value;
        if (id == null) return;
        loading.value = true;
        try {
            await Promise.all([
                store.fetchInstance(id),
                store.fetchTransitions(id),
                notifications.fetchHistory({alertId: id})
            ]);
            await loadFailureDetails();
        } finally {
            loading.value = false;
        }
    }

    // The job list carries states only; the reason lives on the attempts.
    // Load them for the jobs that failed so the modal can say why.
    async function loadFailureDetails(): Promise<void> {
        const failed = deliveryJobs.value.filter((job) =>
            FAILED_JOB_STATES.has(job.state)
        );
        await Promise.all(
            failed.map((job) => notifications.fetchHistoryDetail(job.id))
        );
    }

    function lastErrorFor(jobId: number): string | null {
        const attempts = notifications.attempts[jobId] ?? [];
        for (let i = attempts.length - 1; i >= 0; i--) {
            const message = attempts[i]?.errorMessage;
            if (message) return message;
        }
        return null;
    }

    watch(instanceId, refresh, {immediate: true});

    async function ack(): Promise<void> {
        if (!instance.value) return;
        const ok = await store.ackInstance(instance.value.id);
        if (ok) store.fetchTransitions(instance.value.id);
    }
    async function unack(): Promise<void> {
        if (!instance.value) return;
        const ok = await store.unackInstance(instance.value.id);
        if (ok) store.fetchTransitions(instance.value.id);
    }
    async function unsilence(): Promise<void> {
        if (!instance.value) return;
        const ok = await store.unsilenceInstance(instance.value.id);
        if (ok) store.fetchTransitions(instance.value.id);
    }
    async function resolve(): Promise<void> {
        if (!instance.value) return;
        const ok = await store.resolveInstance(instance.value.id);
        if (ok) store.fetchTransitions(instance.value.id);
    }
    async function onSilence(payload: {
        until: string;
        reason: string | null;
    }): Promise<void> {
        if (!instance.value) return;
        const ok = await store.silenceInstance(
            instance.value.id,
            payload.until,
            payload.reason
        );
        if (ok) store.fetchTransitions(instance.value.id);
    }

    return {
        instance,
        source,
        sourceDevice,
        sourceGroup,
        timeline,
        historyError,
        deliveryJobs,
        lastErrorFor,
        loading,
        silenceVisible,
        silencedActive,
        ageLabel,
        hasContext,
        contextPreview,
        systemHealth,
        firedAgain,
        canWrite,
        formatTs,
        refresh,
        ack,
        unack,
        unsilence,
        resolve,
        onSilence
    };
}

<template>
    <section class="runtime-summary" aria-label="Runtime and deployment summary">
        <header class="runtime-summary__header">
            <div class="runtime-summary__title-row">
                <HealthDot :status="view.runtimeStatus" />
                <div>
                    <h3>Runtime contract</h3>
                    <p>{{ loadedAtLabel }}</p>
                </div>
            </div>
            <div class="runtime-summary__actions">
                <button type="button" title="Refresh" aria-label="Refresh" @click="refresh"><i class="fas fa-sync-alt" /></button>
                <RouterLink to="/monitoring/runtime">Open Runtime</RouterLink>
            </div>
        </header>

        <div class="runtime-summary__grid">
            <article class="runtime-summary__item">
                <span>Version</span>
                <strong>{{ versionLabel }}</strong>
                <small>commit {{ shortSha(view.runtimeIdentity.commit) }}</small>
            </article>
            <article class="runtime-summary__item">
                <span>Deployment</span>
                <strong>{{ view.runtimeIdentity.mode }}</strong>
                <small>{{ view.runtimeIdentity.environment }}</small>
            </article>
            <article class="runtime-summary__item">
                <span>Containers</span>
                <strong :class="containerStatusClass">
                    {{ view.containerSummary.running }}/{{ view.containerSummary.expected }}
                </strong>
                <small>{{ containerProblemLabel }}</small>
            </article>
            <article class="runtime-summary__item">
                <span>Device usage</span>
                <strong :class="deviceUsageClass">{{ deviceUsageLabel }}</strong>
                <small>{{ deviceUsageDetail }}</small>
            </article>
            <article class="runtime-summary__item">
                <span>Deploy checks</span>
                <strong :class="deployCheckClass">{{ deployCheckLabel }}</strong>
                <small>migration, smoke, API, browser</small>
            </article>
            <article class="runtime-summary__item">
                <span>Rollback</span>
                <strong>{{ view.rollbackLabel }}</strong>
                <small>manifest {{ view.manifestStatusLabel }}</small>
            </article>
        </div>
    </section>
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from 'vue';
import HealthDot from '@/components/monitoring/HealthDot.vue';
import {
    buildRuntimeContractView,
    deployCheckStatus,
    type RuntimeRecord, 
    runtimeStatusClass,
    shortSha
} from '@/helpers/monitoringRuntime';
import {loadRuntimeContractPayloads} from '@/helpers/monitoringRuntimeClient';

const loadedAt = ref<number | null>(null);
const versionInfo = ref<RuntimeRecord>({});
const manifestPayload = ref<RuntimeRecord | null>(null);
const deviceUsagePayload = ref<RuntimeRecord | null>(null);
const manifestError = ref<string | null>(null);

const view = computed(() =>
    buildRuntimeContractView({
        versionInfo: versionInfo.value,
        manifestPayload: manifestPayload.value,
        manifestError: manifestError.value,
        deviceUsagePayload: deviceUsagePayload.value
    })
);

const loadedAtLabel = computed(() =>
    loadedAt.value
        ? `Updated ${new Date(loadedAt.value).toLocaleTimeString()}`
        : 'Not loaded yet'
);

const versionLabel = computed(() => {
    const version = versionInfo.value.version;
    if (typeof version === 'string' || typeof version === 'number') {
        return version;
    }
    return 'unknown';
});

const containerStatusClass = computed(() => {
    if (view.value.containerSummary.missing > 0) return 'runtime-danger';
    if (view.value.containerSummary.unexpected > 0) return 'runtime-warning';
    if (view.value.containerSummary.unknownOwner > 0) return 'runtime-warning';
    return runtimeStatusClass('ok');
});

const containerProblemLabel = computed(() => {
    const {missing, unexpected, unknownOwner} = view.value.containerSummary;
    if (missing > 0 || unexpected > 0 || unknownOwner > 0) {
        return `${missing} missing, ${unexpected} unexpected, ${unknownOwner} unknown-owner`;
    }
    return 'expected containers accounted for';
});

const deviceUsageSummary = computed(() => {
    const rows = view.value.deviceUsageRows;
    return {
        clients: rows.length,
        warning: rows.filter((row) => row.warning).length,
        overLimit: rows.filter((row) => row.over_limit).length
    };
});

const deviceUsageClass = computed(() => {
    if (deviceUsageSummary.value.overLimit > 0) return 'runtime-danger';
    if (deviceUsageSummary.value.warning > 0) return 'runtime-warning';
    return runtimeStatusClass('ok');
});

const deviceUsageLabel = computed(() => {
    if (deviceUsageSummary.value.clients === 0) return 'not_available';
    if (deviceUsageSummary.value.overLimit > 0) return 'over_limit';
    if (deviceUsageSummary.value.warning > 0) return 'warning';
    return 'ok';
});

const deviceUsageDetail = computed(() => {
    const summary = deviceUsageSummary.value;
    if (summary.clients === 0) return 'no aggregate usage rows';
    return `${summary.clients} clients, ${summary.overLimit} over limit`;
});

const deployCheckStatuses = computed(() =>
    ['migration', 'smoke', 'api', 'browser'].map((name) =>
        deployCheckStatus(view.value.manifest, name)
    )
);

const deployCheckLabel = computed(() => {
    const statuses = deployCheckStatuses.value;
    if (statuses.some((status) => ['failed', 'invalid'].includes(status))) {
        return 'failed';
    }
    if (statuses.some((status) => status === 'unknown')) return 'unknown';
    if (statuses.every((status) => ['passed', 'ok'].includes(status))) {
        return 'passed';
    }
    return 'mixed';
});

const deployCheckClass = computed(() => runtimeStatusClass(deployCheckLabel.value));

onMounted(() => {
    void refresh();
});

async function refresh(): Promise<void> {
    const payloads = await loadRuntimeContractPayloads();
    versionInfo.value = payloads.versionInfo;
    manifestPayload.value = payloads.manifestPayload;
    manifestError.value = payloads.manifestError;
    deviceUsagePayload.value = payloads.deviceUsagePayload;
    loadedAt.value = Date.now();
}
</script>

<style scoped>
.runtime-summary {
    display: grid;
    gap: var(--gap-sm);
    padding: var(--gap-md);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
}
.runtime-summary__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--gap-md);
}
.runtime-summary__title-row {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
}
.runtime-summary h3,
.runtime-summary p {
    margin: 0;
}
.runtime-summary h3 {
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}
.runtime-summary p,
.runtime-summary small {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.runtime-summary__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--gap-xs);
}
.runtime-summary__actions button,
.runtime-summary__actions a {
    padding: var(--gap-xs) var(--gap-sm);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    background: var(--color-surface-2);
    font-size: var(--type-caption);
}
.runtime-summary__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--gap-sm);
}
.runtime-summary__item {
    display: grid;
    min-width: 0;
    gap: 2px;
}
.runtime-summary__item span {
    color: var(--color-text-disabled);
    font-size: var(--type-caption);
}
.runtime-summary__item strong {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: var(--type-body);
}
.runtime-summary__item strong.runtime-success {
    color: var(--color-success-text);
}
.runtime-summary__item strong.runtime-warning {
    color: var(--color-warning-text);
}
.runtime-summary__item strong.runtime-danger {
    color: var(--color-danger-text);
}
@media (min-width: 900px) {
    .runtime-summary__grid {
        grid-template-columns: repeat(6, minmax(0, 1fr));
    }
}
</style>

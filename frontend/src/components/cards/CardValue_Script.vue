<template>
    <!-- ═══ 1×1: run state word + run/stop switch ═══ -->
    <CardShell
        v-if="size === '1x1'"
        type="script"
        :name="entity.name"
        icon="fas fa-code"
        size="1x1"
        :is-on="isRunning"
        :is-warning="hasErrors"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        :allowed-sizes="allowedSizes"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
        @resize="(s: string) => $emit('resize', s)"
    >
        <template #default>
            <div role="status" class="ec-state-lg" :class="isRunning ? 's-on' : 's-off'">{{ stateWord }}</div>
            <div class="ec-sub ec-sub--sensor">{{ subLine }}</div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
        <template #toggle>
            <CardToggle :is-on="isRunning" :label="toggleLabel" :disabled="!canControl" @toggle="toggle" />
        </template>
    </CardShell>

    <!-- ═══ 2×1: state + boot/fault context on the left, memory + switch right ═══ -->
    <CardShell
        v-else-if="size === '2x1'"
        type="script"
        :name="entity.name"
        icon="fas fa-code"
        size="2x1"
        :is-on="isRunning"
        :is-warning="hasErrors"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        :allowed-sizes="allowedSizes"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
        @resize="(s: string) => $emit('resize', s)"
    >
        <template #default>
            <div class="ec-wide-row">
                <div class="ec-wl">
                    <div role="status" class="ec-state-lg" :class="isRunning ? 's-on' : 's-off'">{{ stateWord }}</div>
                    <div class="sc-meta">{{ subLine }}</div>
                </div>
                <div class="ec-wr">
                    <div class="sc-mem">
                        <span class="sc-mem-v">{{ memUsedDisplay }}</span>
                        <span class="sc-mem-l">Memory</span>
                    </div>
                    <CardToggle :is-on="isRunning" :label="toggleLabel" :disabled="!canControl" @toggle="toggle" />
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- ═══ 2×2: hero state + run/stop + the stats a script actually has ═══ -->
    <CardShell
        v-else
        type="script"
        :name="entity.name"
        icon="fas fa-code"
        size="2x2"
        :is-on="isRunning"
        :is-warning="hasErrors"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        :allowed-sizes="allowedSizes"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
        @resize="(s: string) => $emit('resize', s)"
    >
        <template #default>
            <div class="ec-hero-top">
                <div class="ec-hero-top-v" :class="isRunning ? 's-on' : 's-off'">{{ stateWord }}</div>
                <div class="ec-hero-top-u">script:{{ scriptId }}</div>
            </div>
            <div class="ec-btn-zone">
                <CardToggle :is-on="isRunning" :label="toggleLabel" :disabled="!canControl" @toggle="toggle" />
            </div>
            <div v-if="hasErrors" class="sc-fault" role="alert">
                <i class="fas fa-triangle-exclamation" aria-hidden="true" />
                <span>{{ errorLine }}</span>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
        <template #footer>
            <div class="ec-hero-info">
                <div v-for="stat in heroStats" :key="stat.label" class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ stat.value }}</div>
                    <div class="ec-hero-stat-l">{{ stat.label }}</div>
                </div>
            </div>
        </template>
    </CardShell>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {useCardRpc} from '@/composables/useCardRpc';
import {formatBytes} from '@/helpers/format';
import {allowedSizesForEntity} from '@/helpers/widgetCatalog';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import type {entity_t} from '@/types';
import CardBadges from './CardBadges.vue';
import CardShell from './CardShell.vue';
import CardToggle from './CardToggle.vue';

const props = withDefaults(
    defineProps<{
        entity: entity_t;
        size: '1x1' | '2x1' | '2x2';
        editMode?: boolean;
    }>(),
    {editMode: false}
);

defineEmits<{
    'open-detail': [];
    delete: [];
    'cycle-size': [];
    resize: [size: string];
}>();

const deviceStore = useDevicesStore();
const authStore = useAuthStore();
const rpc = useCardRpc();

const allowedSizes = computed(() => allowedSizesForEntity(props.entity));

const device = computed(() => deviceStore.devices[props.entity.source]);
const isOffline = computed(() => !device.value?.online);
const isSleeping = computed(() => !!device.value?.sleeping);
const canExecute = computed(() =>
    authStore.canExecuteDevice(props.entity.source)
);
// An offline device can't take Script.Start/Stop.
const canControl = computed(() => canExecute.value && !isOffline.value);

const scriptId = computed(() => props.entity.properties.id ?? 0);

const status = computed(() => {
    if (!device.value) return null;
    return (
        deviceStore.statusOf(props.entity.source, `script:${scriptId.value}`) ??
        null
    );
});

const settings = computed(
    () => device.value?.settings?.[`script:${scriptId.value}`] ?? null
);

// Script.GetStatus: `running` is the whole live state of a script.
const isRunning = computed(() => status.value?.running === true);
const stateWord = computed(() => (isRunning.value ? 'Running' : 'Stopped'));
// The switch reads as state, not as a command — RUN when it is running.
const toggleLabel = computed(() => (isRunning.value ? 'RUN' : 'IDLE'));

// Script.GetConfig: `enable` = the script starts by itself after a reboot.
const runsOnBoot = computed(() => settings.value?.enable === true);

const scriptErrors = computed<string[]>(() => {
    const errors = status.value?.errors;
    return Array.isArray(errors) ? errors.map(String) : [];
});
const hasErrors = computed(() => scriptErrors.value.length > 0);
const errorLine = computed(() => scriptErrors.value.map(humanError).join(' · '));

function humanError(code: string): string {
    const words = code.replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

function num(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const memUsedDisplay = computed(() => formatBytes(num(status.value?.mem_used)));

// A fault outranks the boot behaviour.
const subLine = computed(() => {
    if (hasErrors.value) return errorLine.value;
    return runsOnBoot.value ? 'Starts on boot' : 'Manual start';
});

// Only stats the device actually reports (`cpu` is firmware 1.7.0+).
const heroStats = computed<{label: string; value: string}[]>(() => {
    const stats: {label: string; value: string}[] = [];
    const used = num(status.value?.mem_used);
    const peak = num(status.value?.mem_peak);
    const free = num(status.value?.mem_free);
    const cpu = num(status.value?.cpu);
    if (used !== null) stats.push({label: 'Memory', value: formatBytes(used)});
    if (peak !== null) stats.push({label: 'Peak', value: formatBytes(peak)});
    if (cpu !== null) stats.push({label: 'CPU', value: `${cpu.toFixed(1)}%`});
    else if (free !== null)
        stats.push({label: 'Pool free', value: formatBytes(free)});
    stats.push({label: 'On boot', value: runsOnBoot.value ? 'Yes' : 'No'});
    return stats;
});

function toggle() {
    rpc.invokeAction(
        props.entity.id,
        isRunning.value ? 'stop' : 'start',
        undefined,
        props.entity.name
    );
}
</script>

<style scoped>
/* Context line under the state word (2x1) — quiet, never competing with it. */
.sc-meta {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    letter-spacing: var(--tracking-tight);
}

/* 2x1 right column: memory reading stacked above the run switch. */
.sc-mem {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-0-5);
}
.sc-mem-v {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
}
.sc-mem-l {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}

/* 2x2 fault line — a crashed script stops silently, so say why. */
.sc-fault {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    margin-top: var(--space-2);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-danger-text);
}
</style>

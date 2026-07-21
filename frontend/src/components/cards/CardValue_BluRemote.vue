<template>
    <!-- 1×1: compact last-press monitor -->
    <CardShell
        v-if="size === '1x1'"
        type="button"
        :name="entity.name"
        icon="fas fa-satellite-dish"
        size="1x1"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        :allowed-sizes="allowedSizes"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="blu-mini">
                <div class="blu-mini-ic" :class="{act: anyActive}">
                    <i :class="gestureIcon" aria-hidden="true" />
                </div>
                <div class="blu-mini-label">{{ lastPress ? lastPress.label : deviceNoun }}</div>
                <div class="blu-mini-sub">{{ miniSub }}</div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2×1: button row + last-event line -->
    <CardShell
        v-else-if="size === '2x1'"
        type="button"
        :name="entity.name"
        icon="fas fa-satellite-dish"
        size="2x1"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        :allowed-sizes="allowedSizes"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="blu-wide">
                <div class="blu-pads" :style="rowCols">
                    <div
                        v-for="c in controls"
                        :key="c.idx"
                        class="blu-pad"
                        :class="{act: c.active}"
                        :title="c.label"
                    >
                        <span class="blu-pad-num">{{ c.idx + 1 }}</span>
                        <i class="blu-pad-ic" :class="controlIcon(c)" aria-hidden="true" />
                    </div>
                </div>
                <div class="blu-status">{{ statusLine }}</div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2×2: full pad grid + status + battery/signal -->
    <CardShell
        v-else
        type="button"
        :name="entity.name"
        icon="fas fa-satellite-dish"
        size="2x2"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        :allowed-sizes="allowedSizes"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="blu-hero">
                <div class="blu-pads blu-pads--grid" :style="gridCols">
                    <div
                        v-for="c in controls"
                        :key="c.idx"
                        class="blu-pad blu-pad--lg"
                        :class="{act: c.active}"
                        :title="c.label"
                    >
                        <span class="blu-pad-num">{{ c.idx + 1 }}</span>
                        <i class="blu-pad-ic" :class="controlIcon(c)" aria-hidden="true" />
                        <span class="blu-pad-label">{{ c.label }}</span>
                    </div>
                </div>
                <div class="blu-status blu-status--lg">
                    {{ statusLine }}<span v-if="lastPress" class="blu-ago"> · {{ agoText }}</span>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
        <template #footer>
            <div v-if="battery !== null || rssi !== null" class="blu-foot">
                <span v-if="battery !== null"><i class="fas fa-battery-half" aria-hidden="true" /> {{ battery }}%</span>
                <span v-if="rssi !== null"><i class="fas fa-signal" aria-hidden="true" /> {{ rssi }} dBm</span>
            </div>
        </template>
    </CardShell>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import {formatRelative} from '@/helpers/format';
import {useDevicesStore} from '@/stores/devices';
import type {entity_t} from '@/types';
import CardBadges from './CardBadges.vue';
import CardShell from './CardShell.vue';

// Read-only monitor for a physical BLU remote. The backend computes press
// attribution and the per-button flash on the component `overview` status;
// this card only renders it.

interface OverviewControl {
    idx: number;
    kind: 'button' | 'dimmer';
    label: string;
    active: boolean;
}

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
}>();

const deviceStore = useDevicesStore();
const device = computed(() => deviceStore.devices[props.entity.source]);
const isOffline = computed(() => !device.value?.online);
const isSleeping = computed(() => !!device.value?.sleeping);

// Backend overview on the component status: per-control `active` + last-event.
const overview = computed(
    () =>
        deviceStore.statusOf(
            props.entity.source,
            `bthomedevice:${props.entity.properties.id}`
        )?.overview ?? null
);

// Overview controls carry live `active`; the static entity list is the pre-overview fallback.
const propControls = computed<OverviewControl[]>(
    () =>
        (props.entity.properties as {controls?: OverviewControl[]})?.controls ??
        []
);
const controls = computed<OverviewControl[]>(() => {
    const src = overview.value?.controls ?? propControls.value;
    return [...src]
        .map((c: any) => ({
            idx: c.idx,
            kind: c.kind,
            label: c.label,
            active: c.active ?? false
        }))
        .sort((a, b) => a.idx - b.idx);
});

const controlCount = computed(() => controls.value.length);
// A one-button device is a button, not a remote — name it for what it is.
const deviceNoun = computed(() => (controlCount.value === 1 ? 'Button' : 'Remote'));
const anyActive = computed(() => controls.value.some((c) => c.active));
const battery = computed<number | null>(() =>
    typeof overview.value?.battery === 'number' ? overview.value.battery : null
);
const rssi = computed<number | null>(() =>
    typeof overview.value?.rssi === 'number' ? overview.value.rssi : null
);

// Ticking clock so the relative time refreshes without a press.
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
    timer = setInterval(() => {
        now.value = Date.now();
    }, 30_000);
});
onUnmounted(() => {
    if (timer) clearInterval(timer);
});

// Keep the last press after the backend's 4s flash window clears. Key the watch
// on lastUpdatedTs, which the backend bumps on every event, so pressing the same
// button twice still refreshes (the summary string alone would not change). Use
// the device's real event time as the base, never a client guess.
const lastPress = ref<{label: string; summary: string; at: number} | null>(
    null
);
watch(
    () => overview.value?.lastUpdatedTs,
    () => {
        const ov = overview.value;
        if (!ov?.lastEventSummary) return; // a sensor update, not a button press
        lastPress.value = {
            label: ov.lastEventLabel ?? ov.lastEventSummary,
            summary: ov.lastEventSummary,
            at:
                typeof ov.lastUpdatedTs === 'number'
                    ? ov.lastUpdatedTs * 1000
                    : Date.now()
        };
    },
    {immediate: true}
);

// Clamp the base so device/client clock skew can never render a negative "ago".
const agoText = computed(() =>
    lastPress.value
        ? formatRelative(
              lastPress.value.at,
              Math.max(now.value, lastPress.value.at)
          )
        : ''
);

const statusLine = computed(() =>
    lastPress.value ? lastPress.value.summary : 'Waiting for a press'
);

const miniSub = computed(() => {
    if (lastPress.value) return agoText.value;
    // Single button: the label already says "Button", so show readiness instead
    // of a redundant "1 button".
    return controlCount.value === 1
        ? 'Ready'
        : `${controlCount.value} buttons`;
});

const gestureIcon = computed(() =>
    anyActive.value ? 'fas fa-hand-pointer' : 'fas fa-satellite-dish'
);

function controlIcon(c: OverviewControl): string {
    return c.kind === 'dimmer' ? 'fas fa-rotate' : 'fas fa-hand-pointer';
}

// 2x1: one row. 2x2: 2-wide grid, so 4 buttons form a square.
const rowCols = computed(() => ({
    gridTemplateColumns: `repeat(${Math.max(1, controlCount.value)}, 1fr)`
}));
const gridCols = computed(() => ({
    gridTemplateColumns: `repeat(${Math.min(2, Math.max(1, controlCount.value))}, 1fr)`
}));

// Single-button remote has nothing to fill a 2x2. Mirrors allowedSizesForEntity.
const allowedSizes = computed<('1x1' | '2x1' | '2x2')[]>(() =>
    controlCount.value <= 1 ? ['1x1', '2x1'] : ['1x1', '2x1', '2x2']
);
</script>

<style scoped>
/* 1×1 compact monitor */
.blu-mini {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1-5);
    height: 100%;
}
.blu-mini-ic {
    width: 34px;
    height: 34px;
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(var(--ar), 0.1);
    color: rgb(var(--ar));
    transition:
        background var(--duration-fast),
        transform var(--duration-fast);
}
.blu-mini-ic.act {
    background: rgba(var(--ar), 0.22);
    transform: scale(1.08);
}
.blu-mini-label {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-secondary);
}
.blu-mini-sub {
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
}

/* Shared pad grid */
.blu-wide,
.blu-hero {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    height: 100%;
    justify-content: center;
    padding: 0 var(--space-4);
}
.blu-pads {
    display: grid;
    gap: var(--space-2);
    flex: 0 0 auto;
}
.blu-pads--grid {
    flex: 1 1 auto;
    align-content: center;
}
.blu-pad {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-1);
    border-radius: var(--radius-lg);
    border: var(--space-px) solid var(--color-border-medium);
    background: var(--color-surface-1);
    transition:
        background var(--duration-fast),
        border-color var(--duration-fast),
        transform var(--duration-fast);
}
.blu-pad--lg {
    padding: var(--space-3) var(--space-1-5);
    gap: var(--space-1-5);
}
/* Pressed button flash (driven by overview.controls[].active, ~4s window). */
.blu-pad.act {
    background: rgba(var(--ar), 0.16);
    border-color: rgba(var(--ar), 0.4);
    transform: translateY(-1px);
}
.blu-pad-num {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-secondary);
    line-height: 1;
}
.blu-pad.act .blu-pad-num {
    color: rgb(var(--ar));
}
.blu-pad-ic {
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
}
.blu-pad.act .blu-pad-ic {
    color: rgb(var(--ar));
}
.blu-pad-label {
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* Last-event line */
.blu-status {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.blu-status--lg {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-secondary);
}
.blu-ago {
    font-weight: 400;
    color: var(--color-text-quaternary);
}

/* 2×2 footer: battery + signal */
.blu-foot {
    display: flex;
    justify-content: center;
    gap: var(--space-4);
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
}
.blu-foot i {
    margin-right: var(--space-1);
}
</style>

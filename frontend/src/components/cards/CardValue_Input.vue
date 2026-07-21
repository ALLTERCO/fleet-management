<template>
    <!-- 1×1: one centered fact per input mode -->
    <CardShell
        v-if="size === '1x1'"
        type="input"
        :name="entity.name"
        icon="fas fa-toggle-on"
        size="1x1"
        :is-on="isActive"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        :allowed-sizes="allowedSizes"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
        @resize="(s: string) => $emit('resize', s)"
    >
        <template #default>
            <!-- Switch: open/closed contact state -->
            <template v-if="inputMode === 'switch'">
                <div role="status" class="ec-state-lg" :class="isActive ? 's-closed' : 's-open'">{{ switchStateWord }}</div>
                <div class="ec-sub ec-sub--sensor">{{ modeLabel }}</div>
            </template>
            <!-- Button: last gesture + when -->
            <template v-else-if="inputMode === 'button'">
                <div role="status" class="in-gesture">{{ lastGesture ?? 'Ready' }}</div>
                <div class="ec-sub ec-sub--sensor">{{ lastGestureAgo || modeLabel }}</div>
            </template>
            <!-- Analog: calibrated value -->
            <template v-else-if="isAnalog">
                <div class="ec-hv-wrap"><span class="ec-hv in-hv">{{ analogDisplay }}</span><span class="ec-hu">{{ analogUnit }}</span></div>
                <div class="ec-sub ec-sub--sensor">{{ modeLabel }}</div>
            </template>
            <!-- Count: total pulses + live rate -->
            <template v-else-if="isCount">
                <div class="ec-hv-wrap"><span class="ec-hv in-hv">{{ countDisplay }}</span></div>
                <div class="ec-sub ec-sub--sensor">{{ countFreqDisplay !== '—' ? `${countFreqDisplay} Hz` : 'Pulses' }}</div>
            </template>
            <!-- Unknown mode -->
            <template v-else>
                <div role="status" class="ec-state-lg s-off">{{ buttonStateDisplay }}</div>
                <div class="ec-sub ec-sub--sensor">Input</div>
            </template>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2×1: the same fact, centered, with one line of context -->
    <CardShell
        v-else-if="size === '2x1'"
        type="input"
        :name="entity.name"
        icon="fas fa-toggle-on"
        size="2x1"
        :is-on="isActive"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        :allowed-sizes="allowedSizes"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
        @resize="(s: string) => $emit('resize', s)"
    >
        <template #default>
            <!-- Switch: state + wiring -->
            <div v-if="inputMode === 'switch'" class="in-2x1">
                <div role="status" class="ec-state-lg" :class="isActive ? 's-closed' : 's-open'">{{ switchStateWord }}</div>
                <div class="in-meta">Switch input · {{ isInverted ? 'Inverted' : 'Normal' }} signal</div>
            </div>

            <!-- Analog: value + level bar -->
            <div v-else-if="isAnalog" class="in-2x1">
                <div class="ec-hv-wrap"><span class="ec-hv">{{ analogDisplay }}</span><span class="ec-hu">{{ analogUnit }}</span></div>
                <div class="in-bar"><div class="in-bar-fill" :style="{width: `${analogBarPct}%`}" /></div>
                <div class="in-meta">Analog input · raw {{ analogBarPct }}%</div>
            </div>

            <!-- Count: total + live rate -->
            <div v-else-if="isCount" class="in-2x1">
                <div class="ec-hv-wrap"><span class="ec-hv">{{ countDisplay }}</span></div>
                <div class="in-meta">{{ countFreqDisplay }} Hz · {{ countByMinute[0] ?? '—' }} last min · pulses</div>
            </div>

            <!-- Button: last gesture + when -->
            <div v-else class="in-2x1">
                <template v-if="lastGesture">
                    <div role="status" class="in-gesture">{{ lastGesture }}</div>
                    <div class="in-meta">{{ lastGestureAgo }} · {{ eventHistory.length }} recent {{ eventHistory.length === 1 ? 'press' : 'presses' }}</div>
                </template>
                <div v-else class="in-idle">
                    <i class="fas fa-hand-pointer" aria-hidden="true" />
                    <span>No presses yet</span>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref} from 'vue';
import {allowedSizesForEntity} from '@/helpers/widgetCatalog';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import type {entity_t} from '@/types';
import CardBadges from './CardBadges.vue';
import CardShell from './CardShell.vue';

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

// Wired inputs cap at 1x1/2x1 — no 2x2 (see allowedSizesForEntity).
const allowedSizes = computed(() => allowedSizesForEntity(props.entity));

const deviceStore = useDevicesStore();
const entitiesStore = useEntityStore();
const device = computed(() => deviceStore.devices[props.entity.source]);
const isOffline = computed(() => !device.value?.online);
const isSleeping = computed(() => !!device.value?.sleeping);

// ── Event history (client-side ring buffer) ─────────────────────────────
// Buttons are stateless on the device — presses arrive only as live events, so
// the last gesture comes from here, not from status.
interface InputEvent {
    type: string;
    ts: number;
}
const MAX_EVENTS = 10;
const eventHistory = ref<InputEvent[]>([]);
let unsubscribe: (() => void) | null = null;

onMounted(() => {
    unsubscribe = entitiesStore.addListener(
        props.entity.id,
        (event: string) => {
            const list = eventHistory.value;
            list.unshift({type: event, ts: Date.now()});
            if (list.length > MAX_EVENTS) list.length = MAX_EVENTS;
        }
    );
});
onBeforeUnmount(() => {
    unsubscribe?.();
});

const EVENT_LABELS: Record<string, string> = {
    single_push: 'Single',
    double_push: 'Double',
    triple_push: 'Triple',
    long_push: 'Hold',
    btn_down: 'Down',
    btn_up: 'Up'
};

function formatEventType(type: string): string {
    return EVENT_LABELS[type] ?? type;
}

function formatEventTime(ts: number): string {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 5) return 'now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
}

const status = computed(() => {
    if (!device.value) return null;
    const e = props.entity;
    return device.value.status?.[`${e.type}:${e.properties.id}`] ?? null;
});

const settings = computed(() => {
    if (!device.value) return null;
    const e = props.entity;
    return device.value.settings?.[`${e.type}:${e.properties.id}`] ?? null;
});

const inputMode = computed(
    () => props.entity.properties.type ?? settings.value?.type ?? '—'
);

const isAnalog = computed(() => inputMode.value === 'analog');
const isCount = computed(() => inputMode.value === 'count');

const latestEvent = computed(() => eventHistory.value[0] ?? null);
const lastGesture = computed(() =>
    latestEvent.value ? formatEventType(latestEvent.value.type) : null
);
const lastGestureAgo = computed(() =>
    latestEvent.value ? formatEventTime(latestEvent.value.ts) : ''
);

const isActive = computed(() => {
    if (isAnalog.value) return (status.value?.percent ?? 0) > 0;
    if (isCount.value) return (status.value?.counts?.total ?? 0) > 0;
    // Switch-type input: device sends a boolean "state" field.
    return !!status.value?.state;
});

// Analog: prefer xpercent (calibrated), fall back to raw percent.
const analogDisplay = computed(() => {
    const xp = status.value?.xpercent;
    if (xp != null)
        return typeof xp === 'number' ? String(Math.round(xp)) : String(xp);
    const v = status.value?.percent;
    return v != null ? String(Math.round(v)) : '—';
});
const analogUnit = computed(() => props.entity.properties.unit || '%');
// Raw 0-100% for the bar fill, independent of the calibrated value.
const analogBarPct = computed(() =>
    Math.max(0, Math.min(100, Math.round(status.value?.percent ?? 0)))
);

// Count: device reports counts.total / freq / by_minute (Shelly Input docs).
const countDisplay = computed(() => {
    const c = status.value?.counts?.total;
    return typeof c === 'number' ? String(c) : '—';
});
const countFreqDisplay = computed(() => {
    const f = status.value?.freq;
    if (typeof f !== 'number') return '—';
    return f < 10 ? f.toFixed(1) : String(Math.round(f));
});
const countByMinute = computed<number[]>(() => {
    const bm = status.value?.counts?.by_minute;
    return Array.isArray(bm) ? bm.slice(0, 3) : [];
});

// Switch: open/closed wording (closed contact = active), plus config context.
const switchStateWord = computed(() => (isActive.value ? 'Closed' : 'Open'));
const isInverted = computed(() => !!settings.value?.invert);

// The input's configured mode — the useful label under the 1x1 state.
const MODE_LABELS: Record<string, string> = {
    switch: 'Switch mode',
    button: 'Button mode',
    analog: 'Analog mode',
    count: 'Counter mode'
};
const modeLabel = computed(() => MODE_LABELS[inputMode.value] ?? 'Input');

// Unknown mode fallback — a clean on/off word, never the raw type name.
const buttonStateDisplay = computed(() => (isActive.value ? 'ON' : 'OFF'));
</script>

<style scoped>
/* 2x1 — one centered stack per input mode (the value zone is top-aligned at
   this size, so center it here). */
.in-2x1 {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1-5);
    text-align: center;
}

/* 1x1 analog/count value — numbers can fill the whole tile, so take the display
   size (word heroes stay smaller, capped by their width). */
.in-hv {
    font-size: var(--type-display);
    line-height: 0.95;
}

/* Button gesture — single-word hero at the same heading size as the other
   modes (fits: same length as the switch "Closed"). */
.in-gesture {
    font-size: var(--type-heading);
    font-weight: 800;
    letter-spacing: -1.5px;
    line-height: 1;
    color: var(--color-text-primary);
    text-align: center;
}

/* Context line under the hero. */
.in-meta {
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--color-text-tertiary);
    letter-spacing: -0.2px;
    font-variant-numeric: tabular-nums;
}

/* Analog level bar. */
.in-bar {
    width: 72%;
    height: 8px;
    border-radius: var(--radius-full);
    background: var(--color-surface-2);
    overflow: hidden;
}
.in-bar-fill {
    height: 100%;
    border-radius: var(--radius-full);
    background: linear-gradient(90deg, var(--color-primary), var(--a-button));
    transition: width var(--duration-normal) ease;
}

/* Button idle — one clean centered state. */
.in-idle {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-tertiary);
}
.in-idle i {
    font-size: var(--type-subheading);
    opacity: 0.55;
}
.in-idle span {
    font-size: var(--type-body);
}
</style>

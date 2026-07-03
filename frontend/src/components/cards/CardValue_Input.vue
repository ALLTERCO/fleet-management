<template>
    <!-- 1×1: state display + mode subtitle -->
    <CardShell
        v-if="size === '1x1'"
        type="input"
        :name="entity.name"
        icon="fas fa-toggle-on"
        size="1x1"
        :is-on="isActive"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div v-if="isAnalog" class="ec-hv-wrap">
                <span class="ec-hv">{{ analogDisplay }}</span>
                <span class="ec-hu">{{ analogUnit }}</span>
            </div>
            <div v-else-if="isCount" class="ec-hv-wrap">
                <span class="ec-hv">{{ countDisplay }}</span>
                <span class="ec-hu">cnt</span>
            </div>
            <!-- Switch: toggle visual -->
            <template v-else-if="inputMode === 'switch'">
                <svg width="64" height="34" viewBox="0 0 64 34" fill="none">
                    <rect x="1" y="1" width="62" height="32" rx="16" :stroke="isActive ? 'rgba(26,217,178,.3)' : 'rgba(148,163,184,.2)'" stroke-width="1.5" :fill="isActive ? 'rgba(26,217,178,.06)' : 'rgba(148,163,184,.04)'" />
                    <circle :cx="isActive ? 46 : 18" cy="17" r="12" :fill="isActive ? 'var(--color-status-on)' : 'var(--color-frost)'" :opacity="isActive ? 1 : 0.6" />
                    <path v-if="isActive" d="M41 17l3 3 6-6" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
                </svg>
                <div role="status" class="ec-state ec-state-lg" :class="isActive ? 's-on' : ''">{{ isActive ? 'Closed' : 'Open' }}</div>
            </template>
            <!-- Button: ripple circles + event text -->
            <template v-else-if="inputMode === 'button'">
                <div class="ec-input-ripple" :class="lastEvent === 'long_push' ? 'ec-input-ripple--warn' : ''">
                    <div class="ec-input-ring ec-input-ring--outer" />
                    <div class="ec-input-ring ec-input-ring--mid" />
                    <div class="ec-input-ring ec-input-ring--inner">
                        <span v-if="lastEvent === 'single_push'" class="ec-input-press">1&times;</span>
                        <span v-else-if="lastEvent === 'double_push'" class="ec-input-press">2&times;</span>
                        <span v-else-if="lastEvent === 'long_push'" class="ec-input-press ec-input-press--hold">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="6" x2="12" y2="12" /><line x1="12" y1="16" x2="12" y2="16.01" /></svg>
                        </span>
                        <span v-else class="ec-input-press ec-input-press--idle">&mdash;</span>
                    </div>
                </div>
                <div role="status" class="ec-state ec-state-lg s-accent">{{ buttonStateDisplay }}</div>
            </template>
            <div v-else role="status" class="ec-state ec-state-lg s-accent">{{ buttonStateDisplay }}</div>
            <div class="ec-sub ec-sub--sensor">{{ inputTypeWithMode }}</div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2×1: accent state + event history + counters -->
    <CardShell
        v-else-if="size === '2x1'"
        type="input"
        :name="entity.name"
        icon="fas fa-toggle-on"
        size="2x1"
        :is-on="isActive"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="ec-wide-row">
                <div class="ec-wl">
                    <div v-if="isAnalog" class="ec-hv-wrap">
                        <span class="ec-hv">{{ analogDisplay }}</span>
                        <span class="ec-hu">{{ analogUnit }}</span>
                    </div>
                    <div v-else-if="isCount" class="ec-hv-wrap">
                        <span class="ec-hv">{{ countDisplay }}</span>
                        <span class="ec-hu">cnt</span>
                    </div>
                    <div v-else class="ec-hv-wrap">
                        <span class="ec-hv ec-hv--accent">{{ buttonStateInline }}</span>
                    </div>
                    <div class="ec-sub ec-sub--static">{{ inputTypeWithMode }}</div>
                </div>
                <div class="ec-wr">
                    <div class="ec-input-events">
                        <template v-if="eventHistory.length">
                            <div v-for="(ev, i) in eventHistory.slice(0, 3)" :key="i" class="ec-input-ev">
                                <span class="ec-input-ts">{{ formatEventTime(ev.ts) }}</span>
                                <span class="ec-input-act" :style="{color: isLongPush(ev.type) ? 'var(--color-status-warn)' : 'var(--a-button)'}">{{ formatEventType(ev.type) }}</span>
                            </div>
                        </template>
                        <div v-else class="ec-input-ev">
                            <span class="ec-input-ts">—</span>
                            <span class="ec-input-act ec-input-act--waiting">Waiting for events</span>
                        </div>
                    </div>
                    <div class="ec-tl-stats">
                        <div class="ec-tl-stat"><b>{{ todayEventCount || '—' }}</b> session</div>
                        <div class="ec-tl-stat"><b>{{ eventHistory.length }}</b> captured</div>
                    </div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2×2: hero state + event timeline + event log + stats -->
    <CardShell
        v-else
        type="input"
        :name="entity.name"
        icon="fas fa-toggle-on"
        size="2x2"
        :is-on="isActive"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="ec-hero-top ec-hero-top--right">
                <div>
                    <div v-if="isAnalog" class="ec-hv-wrap">
                        <span class="ec-hv">{{ analogDisplay }}</span>
                        <span class="ec-hu">{{ analogUnit }}</span>
                    </div>
                    <div v-else-if="isCount" class="ec-hv-wrap">
                        <span class="ec-hv">{{ countDisplay }}</span>
                        <span class="ec-hu">count</span>
                    </div>
                    <div v-else role="status" class="ec-state s-open ec-state-lg s-accent ec-state--hero-accent">{{ buttonStateInline }}</div>
                    <div class="ec-hero-top-u">{{ isAnalog ? analogRawDisplay : lastEventDetail }}</div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
        <template #footer>
            <!-- Event timeline -->
            <div class="ec-tl-wrap">
                <div class="ec-tl-bar ec-tl-bar--6">
                    <div class="ec-tl-seg ec-tl-seg--f2 ec-tl-seg--empty"></div>
                    <div class="ec-tl-seg ec-tl-seg--f1 ec-tl-seg--full"></div>
                    <div class="ec-tl-seg ec-tl-seg--f3 ec-tl-seg--empty"></div>
                    <div class="ec-tl-seg ec-tl-seg--f1 ec-tl-seg--full"></div>
                    <div class="ec-tl-seg ec-tl-seg--f1 ec-tl-seg--empty"></div>
                    <div class="ec-tl-seg ec-tl-seg--f1 ec-tl-seg--warn"></div>
                    <div class="ec-tl-seg ec-tl-seg--f2 ec-tl-seg--empty"></div>
                    <div class="ec-tl-seg ec-tl-seg--f1 ec-tl-seg--full"></div>
                    <div class="ec-tl-seg ec-tl-seg--f1 ec-tl-seg--full"></div>
                    <div class="ec-tl-seg ec-tl-seg--f4 ec-tl-seg--empty"></div>
                    <div class="ec-tl-seg ec-tl-seg--f1 ec-tl-seg--full"></div>
                    <div class="ec-tl-seg ec-tl-seg--f6 ec-tl-seg--empty"></div>
                </div>
                <div class="ec-tl-axis"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span></div>
            </div>
            <!-- Recent events log -->
            <div class="ec-input-log">
                <template v-if="eventHistory.length">
                    <div v-for="(ev, i) in eventHistory.slice(0, 5)" :key="i" class="ec-input-ev">
                        <span class="ec-input-ts">{{ formatEventTime(ev.ts) }}</span>
                        <span class="ec-input-act" :style="{color: isLongPush(ev.type) ? 'var(--color-status-warn)' : 'var(--a-button)'}">{{ formatEventType(ev.type) }}</span>
                        <span class="ec-input-detail">{{ ev.type }}</span>
                    </div>
                </template>
                <div v-else class="ec-input-ev">
                    <span class="ec-input-ts">—</span>
                    <span class="ec-input-act ec-input-act--waiting">Waiting for events</span>
                    <span class="ec-input-detail">Press a button to see events</span>
                </div>
            </div>
            <!-- Hero stats -->
            <div class="ec-hero-info">
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ isAnalog ? analogRawPct : String(todayEventCount) }}</div>
                    <div class="ec-hero-stat-l">{{ isAnalog ? 'Raw %' : 'Session' }}</div>
                </div>
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ isAnalog ? analogUnit : String(eventHistory.length) }}</div>
                    <div class="ec-hero-stat-l">{{ isAnalog ? 'Unit' : 'Captured' }}</div>
                </div>
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ inputTypeShort }}</div>
                    <div class="ec-hero-stat-l">Type</div>
                </div>
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ inputModeShort }}</div>
                    <div class="ec-hero-stat-l">Mode</div>
                </div>
            </div>
        </template>
    </CardShell>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref} from 'vue';
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
}>();

const deviceStore = useDevicesStore();
const entitiesStore = useEntityStore();
const device = computed(() => deviceStore.devices[props.entity.source]);
const isOffline = computed(() => !device.value?.online);
const isSleeping = computed(() => !!device.value?.sleeping);

// ── Event History (client-side ring buffer) ─────────────────────────────
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
    single_push: '1\u00d7 Press',
    double_push: '2\u00d7 Press',
    triple_push: '3\u00d7 Press',
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

function isLongPush(type: string): boolean {
    return type === 'long_push';
}

const todayEventCount = computed(() => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const ms = midnight.getTime();
    return eventHistory.value.filter((e) => e.ts >= ms).length;
});

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

const inputMode = computed(() => {
    // Input mode from entity properties or settings
    const mode = props.entity.properties.type ?? settings.value?.type;
    return mode ?? '—';
});

const isAnalog = computed(() => inputMode.value === 'analog');
const isCount = computed(() => inputMode.value === 'count');
const lastEvent = computed(
    () => status.value?.last_event as string | undefined
);

const isActive = computed(() => {
    if (isAnalog.value) return (status.value?.percent ?? 0) > 0;
    if (isCount.value) return (status.value?.count ?? 0) > 0;
    // Switch-type input: device sends "state" field (boolean)
    return !!status.value?.state;
});

// Analog: prefer xpercent (calibrated) value, fall back to raw percent
const analogDisplay = computed(() => {
    const xp = status.value?.xpercent;
    if (xp != null)
        return typeof xp === 'number' ? String(Math.round(xp)) : String(xp);
    const v = status.value?.percent;
    return v != null ? String(Math.round(v)) : '—';
});

const analogUnit = computed(() => props.entity.properties.unit || '%');

// Raw percentage (before xpercent transformation) — shown in 2x2 stats
const analogRawPct = computed(() => {
    const v = status.value?.percent;
    return v != null ? `${Math.round(v)}%` : '—';
});

// Subtitle for 2x2 analog: show raw vs calibrated relationship
const analogRawDisplay = computed(() => {
    const raw = status.value?.percent;
    if (raw == null) return '—';
    return `Raw: ${Math.round(raw)}%`;
});

const countDisplay = computed(() => {
    const c = status.value?.count;
    return c != null ? String(c) : '—';
});

// Button state display for 1x1 (multiline-friendly)
const buttonStateDisplay = computed(() => {
    if (inputMode.value === 'button') {
        const last = status.value?.last_event;
        if (last === 'single_push') return '1\u00d7 Press';
        if (last === 'double_push') return '2\u00d7 Press';
        if (last === 'long_push') return 'Hold';
        return 'Button';
    }
    return isActive.value ? 'ON' : 'OFF';
});

// Button state display inline (single line for 2x1 / 2x2)
const buttonStateInline = computed(() => {
    if (inputMode.value === 'button') {
        const last = status.value?.last_event;
        if (last === 'single_push') return '1\u00d7 Press';
        if (last === 'double_push') return '2\u00d7 Press';
        if (last === 'long_push') return 'Hold';
        return 'Button';
    }
    return isActive.value ? 'ON' : 'OFF';
});

const inputTypeShort = computed(() => {
    const mode = inputMode.value;
    if (mode === 'button') return 'Button';
    if (mode === 'switch') return 'Switch';
    if (mode === 'analog') return 'Analog';
    if (mode === 'count') return 'Counter';
    return '—';
});

const inputModeShort = computed(() => {
    // Linked output determines "detached" vs mode name
    const linked = settings.value?.linked_output;
    if (linked == null) return 'Detach';
    return 'Linked';
});

const inputTypeWithMode = computed(() => {
    const parts = [inputTypeShort.value];
    const linked = settings.value?.linked_output;
    if (linked == null) {
        parts.push('Detached');
    } else {
        parts.push('Linked');
    }
    return parts.join(' \u00b7 ');
});

const lastEventDetail = computed(() => {
    const last = status.value?.last_event;
    return last ? `${last}` : '—';
});
</script>

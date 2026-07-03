<template>
    <!-- Vertical mode (list view) -->
    <div v-if="vertical"
        class="widget-card flex flex-row items-center gap-3 rounded-lg shadow-none p-3 relative text-sm min-h-[76px] justify-start hover:cursor-pointer"
        @click="emit('select')"
    >
        <div class="group-card__icon-wrap">
            <i class="fas fa-cubes" />
        </div>
        <div class="flex-grow text-left overflow-hidden min-w-0">
            <div class="font-semibold leading-snug line-clamp-2">{{ name }}</div>
            <span class="group-card__subtitle">
                {{ members.length }} device{{ members.length === 1 ? '' : 's' }}<template v-if="subgroupCount"> · {{ subgroupCount }} subgroup{{ subgroupCount === 1 ? '' : 's' }}</template>
            </span>
        </div>
        <div class="min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0">
            <Button v-if="editMode" type="red" size="sm" @click.stop="emit('delete')">Delete</Button>
            <slot v-else name="widget-action" />
        </div>
    </div>

    <!-- Grid mode (new card design) -->
    <div v-else class="group-card" :class="{ 'group-card--selected': selected }" @click="emit('select')">
        <!-- Status bar (colored by health) -->
        <div class="group-card__bar" :style="{ background: barGradient }" />

        <!-- Head -->
        <div class="group-card__head">
            <span class="group-card__type">
                <i class="fas fa-cubes" /> Group
            </span>
            <div class="group-card__counts">
                <span class="group-card__chip">
                    <i class="fas fa-microchip" /> {{ members.length }}
                </span>
                <span v-if="subgroupCount" class="group-card__chip group-card__chip--sub">
                    <i class="fas fa-folder" /> {{ subgroupCount }}
                </span>
                <span v-if="offlineCount > 0" class="group-card__chip group-card__chip--danger">
                    <i class="fas fa-circle-xmark" /> {{ offlineCount }}
                </span>
            </div>
        </div>

        <!-- Health dot grid -->
        <div class="group-card__dots">
            <span
                v-for="(m, i) in memberDots"
                :key="i"
                class="group-card__dot"
                :class="m.cls"
                :title="m.name"
            />
        </div>

        <!-- Alert banner -->
        <div v-if="offlineCount > 0" class="group-card__alert">
            <i class="fas fa-triangle-exclamation" />
            {{ offlineCount }} offline
        </div>

        <!-- Summary stats -->
        <div v-if="hasSummary" class="group-card__summary">
            <span v-if="totalPower != null" class="group-card__stat">
                <i class="fas fa-bolt" /> {{ formatPower(totalPower) }}
            </span>
            <span v-if="avgTemp != null" class="group-card__stat">
                <i class="fas fa-temperature-half" /> {{ avgTemp.toFixed(1) }}°C
            </span>
        </div>

        <!-- Name -->
        <div class="group-card__name">
            <div class="group-card__label">{{ name }}</div>
        </div>

        <!-- Metadata button -->
        <button
            v-if="hasMetadata"
            ref="infoBtnRef"
            aria-label="Show metadata"
            class="group-card__info-btn"
            title="Metadata"
            @mouseenter="onEnter"
            @mouseleave="onLeave"
            @click.stop="togglePinned"
        >
            <i class="fas fa-info" />
        </button>

        <!-- Metadata popover -->
        <FloatingPanel
            :open="showPopover"
            :anchor="infoBtnRef"
            placement="top-end"
            :offset="8"
            :min-width="220"
            :max-width="280"
            :close-on-outside="pinned"
            :close-on-escape="pinned"
            panel-class="floating-panel--glass rounded-lg p-3"
            @close="closePopover"
        >
            <div
                class="min-w-[220px] max-w-[min(280px,90vw)]"
                @mouseenter="onEnter"
                @mouseleave="onLeave"
            >
                <div class="mb-2 text-sm font-semibold" style="color: var(--color-text-primary)">Metadata</div>
                <div class="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5">
                    <div v-for="([k, v], idx) in entries" :key="idx">
                        <span style="color: var(--color-text-secondary)">{{ k }}</span>
                        <span style="color: var(--color-text-tertiary)">: </span>
                        <span style="color: var(--color-text-primary)">{{ v }}</span>
                    </div>
                </div>
            </div>
        </FloatingPanel>

        <!-- Edit mode overlay -->
        <div v-if="editMode" class="group-card__edit">
            <Button type="red" size="sm" @click.stop="emit('delete')">Delete</Button>
            <slot name="widget-action" />
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {useDevicesStore} from '@/stores/devices';
import Button from '../core/Button.vue';
import FloatingPanel from '../core/FloatingPanel.vue';

const props = defineProps<{
    name: string;
    members: string[];
    metadata?: Record<string, any>;
    editMode?: boolean;
    vertical?: boolean;
    selected?: boolean;
    subgroupCount?: number;
}>();

const emit = defineEmits<{
    delete: [];
    select: [];
}>();

const deviceStore = useDevicesStore();

// Health computation from member devices
const memberDots = computed(() =>
    props.members.map((id) => {
        const d = deviceStore.devices[id];
        if (!d) return {name: id, cls: 'group-card__dot--unknown'};
        const label = d.shellyID ?? id;
        if (d.sleeping) return {name: label, cls: 'group-card__dot--sleep'};
        if (!d.online) return {name: label, cls: 'group-card__dot--off'};
        return {name: label, cls: 'group-card__dot--on'};
    })
);

const offlineCount = computed(
    () =>
        memberDots.value.filter((m) => m.cls === 'group-card__dot--off').length
);

const barGradient = computed(() => {
    if (props.members.length === 0)
        return 'linear-gradient(90deg, var(--color-text-disabled) 0%, transparent 100%)';
    if (offlineCount.value > 0)
        return 'linear-gradient(90deg, color-mix(in srgb, var(--color-status-off) 80%, transparent) 0%, color-mix(in srgb, var(--color-status-off) 13%, transparent) 50%, transparent 100%)';
    return 'linear-gradient(90deg, color-mix(in srgb, var(--color-status-on) 80%, transparent) 0%, color-mix(in srgb, var(--color-status-on) 13%, transparent) 50%, transparent 100%)';
});

// Summary stats — aggregate power + temperature from member devices (single pass)
const summaryStats = computed(() => {
    let powerSum = 0;
    let powerFound = false;
    let tempSum = 0;
    let tempCount = 0;
    for (const id of props.members) {
        const s = deviceStore.devices[id]?.status;
        if (!s) continue;
        for (const key of Object.keys(s)) {
            const v = s[key];
            if (!v || typeof v !== 'object') continue;
            // Power: apower (switch/pm1) or act_power (em/em1)
            if (typeof v.apower === 'number') {
                powerSum += v.apower;
                powerFound = true;
            } else if (typeof v.act_power === 'number') {
                powerSum += v.act_power;
                powerFound = true;
            }
            // Temperature
            if (typeof v.tC === 'number') {
                tempSum += v.tC;
                tempCount++;
            }
        }
    }
    return {
        power: powerFound ? powerSum : null,
        temp: tempCount > 0 ? tempSum / tempCount : null
    };
});

const totalPower = computed(() => summaryStats.value.power);
const avgTemp = computed(() => summaryStats.value.temp);
const hasSummary = computed(
    () => totalPower.value != null || avgTemp.value != null
);

function formatPower(w: number): string {
    if (Math.abs(w) >= 1000) return `${(w / 1000).toFixed(1)} kW`;
    return `${w.toFixed(0)} W`;
}

// Metadata popover
const hovering = ref(false);
const pinned = ref(false);
const infoBtnRef = ref<HTMLElement | null>(null);

const entries = computed(() => {
    const meta = props.metadata ?? {};
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return [];
    return Object.entries(meta)
        .filter(([k]) => String(k).trim().length > 0)
        .map(([k, v]) => [String(k), v == null ? '' : String(v)] as const);
});
const hasMetadata = computed(() => entries.value.length > 0);
const showPopover = computed(
    () => hasMetadata.value && (hovering.value || pinned.value)
);
function onEnter() {
    hovering.value = true;
}
function onLeave() {
    hovering.value = false;
}
function togglePinned() {
    pinned.value = !pinned.value;
}
function closePopover() {
    pinned.value = false;
}
</script>

<style scoped>
.group-card {
    width: var(--grid-min-width);
    display: flex;
    flex-direction: column;
    border-radius: var(--dcard-radius);
    overflow: hidden;
    cursor: pointer;
    position: relative;
    background: var(--dcard-bg);
    border: 1px solid var(--dcard-border);
    transition:
        transform 0.3s cubic-bezier(0.34, 1.1, 0.64, 1),
        box-shadow 0.3s ease;
}
.group-card:hover {
    transform: none;
    box-shadow: var(--dcard-hover-shadow);
}
.group-card--selected {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-primary), var(--shadow-primary);
}

/* Status bar */
.group-card__bar {
    height: 2px;
}

/* Head */
.group-card__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) 10px 0;
}
.group-card__type {
    font-size: var(--type-body);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: none;
    color: var(--color-primary);
    opacity: 0.8;
}
.group-card__type i {
    margin-right: var(--space-0-5);
}
.group-card__counts {
    display: flex;
    gap: var(--space-1);
}
.group-card__chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-0-5) 7px;
    border-radius: var(--radius-2xl);
    background: rgba(var(--color-primary-rgb), 0.1);
    border: 1px solid rgba(var(--color-primary-rgb), 0.25);
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-primary);
}
.group-card__chip--sub {
    background: color-mix(in srgb, var(--color-frost) 10%, transparent);
    border-color: color-mix(in srgb, var(--color-frost) 25%, transparent);
    color: var(--color-frost);
}
.group-card__chip--danger {
    background: rgba(240, 78, 94, 0.12);
    border-color: rgba(240, 78, 94, 0.35);
    color: var(--color-status-off);
}

/* Health dot grid */
.group-card__dots {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    padding: var(--space-3);
    min-height: 48px;
    align-content: flex-start;
}
.group-card__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    transition: background 0.3s, box-shadow 0.3s;
}
.group-card__dot--on {
    background: var(--color-status-on);
    box-shadow: 0 0 6px color-mix(in srgb, var(--color-status-on) 60%, transparent);
}
.group-card__dot--off {
    background: var(--color-status-off);
    box-shadow: 0 0 6px color-mix(in srgb, var(--color-status-off) 50%, transparent);
}
.group-card__dot--sleep {
    background: var(--color-accent);
    box-shadow: 0 0 4px color-mix(in srgb, var(--color-accent) 40%, transparent);
}
.group-card__dot--unknown {
    background: var(--color-text-disabled);
    opacity: 0.4;
}

/* Alert banner */
.group-card__alert {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0 var(--space-3);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    background: rgba(240, 78, 94, 0.08);
    border: 1px solid rgba(240, 78, 94, 0.2);
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-status-off);
}

/* Summary stats */
.group-card__summary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-1) var(--space-3) var(--space-1-5);
}
.group-card__stat {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-secondary);
}
.group-card__stat i {
    font-size: var(--type-body);
    opacity: 0.7;
}

/* Name */
.group-card__name {
    text-align: center;
    padding: var(--space-2) var(--space-3) var(--space-3);
    border-top: 1px solid var(--dcard-name-border);
    margin-top: auto;
    min-height: 2.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
}
.group-card__name::before {
    content: '';
    position: absolute;
    top: calc(-1 * var(--space-1));
    left: 50%;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--dcard-name-border);
    transform: translateX(-50%);
}
.group-card__label {
    font-size: var(--type-body);
    font-weight: 700;
    letter-spacing: -0.3px;
    line-height: 1.3;
    word-break: break-word;
    color: var(--dcard-name-color);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

/* Info button */
.group-card__info-btn {
    position: absolute;
    bottom: var(--space-12);
    right: var(--space-2);
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgba(var(--color-primary-rgb), 0.15);
    border: 1px solid rgba(var(--color-primary-rgb), 0.3);
    color: var(--color-primary);
    font-size: var(--type-body);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.2s;
    z-index: 2;
}
.group-card__info-btn::after {
    content: "";
    position: absolute;
    inset: -10px;
}
.group-card__info-btn:hover {
    background: rgba(var(--color-primary-rgb), 0.3);
}

/* Subtitle (vertical mode) */
.group-card__subtitle {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}

/* Icon wrap (vertical mode) */
.group-card__icon-wrap {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(var(--color-primary-rgb), 0.12);
    border: 1px solid rgba(var(--color-primary-rgb), 0.25);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-primary);
    font-size: var(--type-body);
    flex-shrink: 0;
}

/* Edit overlay */
.group-card__edit {
    position: absolute;
    inset: 0;
    background: var(--color-overlay);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    z-index: 5;
    border-radius: var(--dcard-radius);
}
</style>

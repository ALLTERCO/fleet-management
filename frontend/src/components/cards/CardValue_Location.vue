<template>
    <!-- Dashboard-tile mode: rendered when `size` prop is given. -->
    <div
        v-if="size"
        class="lc lc--tile"
        :class="[`lc--${size}`, {'lc-selected': selected}]"
        tabindex="0"
        @click="$emit('open-preview')"
        @keydown.enter="$emit('open-preview')"
    >
        <div class="lc-bar" :class="healthBarClass" />
        <div class="lc-tile-body">
            <div class="lc-hdr">
                <i class="fas fa-location-dot lc-tile-icon" />
                <span class="lc-kind">{{ kindLabel }}</span>
            </div>
            <div class="lc-name">{{ resolvedName }}</div>
            <div v-if="size !== '1x1' && summaryLine" class="lc-addr">{{ summaryLine }}</div>
            <div class="lc-stats">
                <span class="lc-stat">
                    <span class="lc-hdot lc-hdot--on" />
                    <span class="lc-stat-v">{{ onlineDevices }}</span>
                    <span class="lc-stat-l">online</span>
                </span>
                <span v-if="offlineDevices > 0" class="lc-stat">
                    <span class="lc-hdot lc-hdot--off" />
                    <span class="lc-stat-v">{{ offlineDevices }}</span>
                    <span class="lc-stat-l">offline</span>
                </span>
                <span class="lc-stat lc-stat--total">
                    <i class="fas fa-microchip lc-stat-icon" />
                    <span class="lc-stat-v">{{ totalDevices }}</span>
                </span>
            </div>
        </div>
        <div v-if="editMode" class="lc-edit" @click.stop>
            <button class="lc-edit-btn" title="Move left" @click="$emit('move', -1)">
                <i class="fas fa-arrow-left" />
            </button>
            <button class="lc-edit-btn" title="Move right" @click="$emit('move', 1)">
                <i class="fas fa-arrow-right" />
            </button>
            <button v-if="resizable" class="lc-edit-btn" title="Cycle size" @click="$emit('cycle-size')">
                <i class="fas fa-expand" />
            </button>
            <button class="lc-edit-btn lc-edit-btn--del" title="Remove card" @click="$emit('delete')">
                <i class="fas fa-xmark" />
            </button>
        </div>
    </div>

    <!-- Picker mode: status-bar accent on top mirrors the dashboard tile so
         the catalog visually matches what will be added. -->
    <div
        v-else
        class="lc"
        :class="{'lc-selected': selected}"
        tabindex="0"
        @click="$emit('open-preview')"
        @keydown.enter="$emit('open-preview')"
    >
        <div class="lc-bar" :class="healthBarClass" />
        <div class="lc-body">
            <div class="lc-hdr">
                <i class="fas fa-location-dot lc-icon" />
                <span class="lc-kind">{{ kindLabel }}</span>
                <span v-if="childCount > 0" class="lc-count">
                    <i class="fas fa-diagram-project" />
                    {{ childCount }}
                </span>
            </div>
            <div class="lc-name">{{ resolvedName }}</div>
            <div v-if="summaryLine" class="lc-addr">{{ summaryLine }}</div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type {Location as ApiLocation} from '@api/location';
import {LOCATION_KIND_LABELS} from '@api/location';
import {computed} from 'vue';
import {useDevicesStore} from '@/stores/devices';
import {useLocationsStore} from '@/stores/locations';

interface AddressSummary {
    city?: string;
    region?: string;
    countryCode?: string;
}

const props = withDefaults(
    defineProps<{
        // Picker mode: pass the full location object.
        location?: ApiLocation;
        // Dashboard-tile mode: pass the locationId; component looks up the
        // location + assigned devices and renders sized layout.
        locationId?: number;
        size?: '1x1' | '2x1' | '2x2';
        childCount?: number;
        selected?: boolean;
        editMode?: boolean;
        resizable?: boolean;
    }>(),
    {
        location: undefined,
        locationId: undefined,
        size: undefined,
        childCount: 0,
        selected: false,
        editMode: false,
        resizable: true
    }
);

defineEmits<{
    'open-preview': [];
    delete: [];
    move: [direction: number];
    'cycle-size': [];
}>();

const locationsStore = useLocationsStore();
const devicesStore = useDevicesStore();

// Resolve the active location from either prop, preferring the explicit object.
const activeLocation = computed<ApiLocation | undefined>(() => {
    if (props.location) return props.location;
    if (props.locationId != null)
        return locationsStore.locations[props.locationId];
    return undefined;
});

const resolvedName = computed(
    () => activeLocation.value?.name ?? `Location ${props.locationId ?? '?'}`
);

const kindLabel = computed(() => {
    const k = activeLocation.value?.kind;
    return k ? LOCATION_KIND_LABELS[k] : 'Location';
});

// Pick the most informative one-line summary available without duplicating
// the backend's field descriptors — use the effective chain first, address second.
const summaryLine = computed(() => {
    const loc = activeLocation.value;
    if (!loc) return '';
    const eff = loc.effective;
    const addr = (loc.kindFields as Record<string, unknown>).address as
        | AddressSummary
        | null
        | undefined;
    const addrLine = addr
        ? [addr.city, addr.region, addr.countryCode].filter(Boolean).join(', ')
        : '';
    if (addrLine) return addrLine;
    return [eff?.countryCode, eff?.currency, eff?.timezone]
        .filter(Boolean)
        .join(' · ');
});

const locationDevices = computed(() => {
    const id = activeLocation.value?.id ?? props.locationId;
    if (id == null) return [];
    return Object.values(devicesStore.devices).filter(
        (d) => d.locationId === id
    );
});
const totalDevices = computed(() => locationDevices.value.length);
const onlineDevices = computed(
    () => locationDevices.value.filter((d) => d.online).length
);
const offlineDevices = computed(
    () => totalDevices.value - onlineDevices.value
);
const healthBarClass = computed(() => {
    if (totalDevices.value === 0) return 'lc-bar--neutral';
    if (onlineDevices.value === 0) return 'lc-bar--err';
    if (offlineDevices.value > 0) return 'lc-bar--warn';
    return 'lc-bar--ok';
});
</script>

<style scoped>
/* ── Picker (used in lists / catalog) — shares status-bar accent + body
   shape with the dashboard tile mode below so the picker matches what the
   user is about to add. ── */
.lc {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    overflow: hidden;
    cursor: pointer;
    transition:
        border-color var(--duration-fast),
        background var(--duration-fast),
        transform var(--motion-hover);
}
.lc:hover {
    border-color: var(--color-border-strong);
    background: var(--color-surface-2);
    transform: translateY(-1px);
}
.lc:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
}
.lc-selected {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px
        color-mix(in srgb, var(--color-primary) 30%, transparent);
}
.lc-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3) var(--space-4);
}
.lc-hdr {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.lc-icon {
    color: var(--color-text-tertiary);
    font-size: var(--type-card-footer);
}
.lc-kind {
    flex: 1;
    font-size: var(--type-card-footer);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
    font-weight: var(--font-semibold);
}
.lc-count {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-card-footer);
    color: var(--color-text-tertiary);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-surface-2);
}
.lc-name {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
}
.lc-addr {
    font-size: var(--type-card-footer);
    color: var(--color-text-tertiary);
}

/* ── Dashboard tile mode ── */
.lc--tile {
    position: relative;
    padding: 0;
    gap: 0;
    height: 100%;
    overflow: hidden;
}
.lc-bar {
    height: 3px;
    width: 100%;
    flex-shrink: 0;
}
.lc-bar--ok { background: var(--color-status-on); }
.lc-bar--warn { background: var(--color-status-warn); }
.lc-bar--err { background: var(--color-status-off); }
.lc-bar--neutral { background: var(--color-border-default); }
.lc-tile-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
    padding: var(--gap-sm);
    min-height: 0;
}
.lc-tile-body .lc-hdr {
    color: var(--color-text-tertiary);
    font-size: var(--type-card-footer);
    font-weight: var(--font-semibold);
}
.lc-tile-icon {
    color: var(--a-action);
}
.lc-tile-body .lc-name {
    font-size: var(--type-subheading);
}
.lc--1x1 .lc-tile-body .lc-name {
    font-size: var(--type-body);
}
.lc-stats {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
    margin-top: auto;
    flex-wrap: wrap;
}
.lc-stat {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
}
.lc-hdot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
}
.lc-hdot--on { background: var(--color-status-on); }
.lc-hdot--off { background: var(--color-status-off); }
.lc-stat-icon {
    color: var(--color-text-tertiary);
    font-size: var(--type-card-footer);
}
.lc-stat-v {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-primary);
}
.lc-stat-l {
    font-size: var(--type-card-footer);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
}
.lc-edit {
    position: absolute;
    top: var(--space-1-5);
    right: var(--space-1-5);
    display: flex;
    gap: var(--space-1);
}
.lc-edit-btn {
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    cursor: pointer;
}
.lc-edit-btn--del:hover { color: var(--color-status-off); }
</style>

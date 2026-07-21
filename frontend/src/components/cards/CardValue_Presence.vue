<template>
    <!-- ═══════════════════════════════════════════════════════════════════
         SENSOR CARD (presence entity) — stats only, no radar
    ═══════════════════════════════════════════════════════════════════ -->

    <!-- ═══ sensor 1×1 ═══ -->
    <CardShell
        v-if="isSensorCard && size === '1x1'"
        type="presence"
        :name="entity.name"
        icon="fas fa-radar"
        size="1x1"
        :is-on="anyOccupied"
        :is-offline="isOffline"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="pz-mini" :class="anyOccupied ? 'pz-state--on' : 'pz-state--off'">
                <div class="pz-mini-circle">
                    <div class="pz-mini-circle-bg" :class="anyOccupied ? 'pz-circle--on' : 'pz-circle--off'">
                        <i class="fas fa-radar pz-mini-icon" />
                    </div>
                    <span v-if="anyOccupied && totalPeople > 0" class="pz-mini-badge">{{ totalPeople }}</span>
                </div>
                <div class="pz-mini-text">
                    <div class="pz-mini-label">{{ anyOccupied ? 'Occupied' : 'Empty' }}</div>
                </div>
                <div v-if="illumination" class="pz-ill-pill" :class="`pz-ill--${illumination}`">
                    <i :class="illuminationIcon" />
                    <span>{{ illuminationLabel }}</span>
                </div>
            </div>
        </template>
        <template #badges>
            <span v-if="!sensorEnabled" class="pz-badge-off" title="Sensor disabled">
                <i class="fas fa-eye-slash" />
            </span>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- ═══ sensor 2×1 ═══ -->
    <CardShell
        v-else-if="isSensorCard && size === '2x1'"
        type="presence"
        :name="entity.name"
        icon="fas fa-radar"
        size="2x1"
        :is-on="anyOccupied"
        :is-offline="isOffline"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="ps-wide">
                <div class="ps-wide-hero" :class="anyOccupied ? 'pz-state--on' : 'pz-state--off'">
                    <div class="ps-wide-count">{{ totalPeople > 0 ? totalPeople : '—' }}</div>
                    <div class="ps-wide-unit">{{ totalPeople === 1 ? 'person' : 'people' }}</div>
                </div>
                <div class="ps-wide-stats">
                    <div class="ps-stat">
                        <i :class="illuminationIcon || 'fas fa-lightbulb'" class="ps-stat-icon" />
                        <span>{{ illuminationLabel ?? '—' }}</span>
                    </div>
                    <div class="ps-stat">
                        <i class="fas fa-crosshairs ps-stat-icon" />
                        <span>{{ detectionRange ?? '—' }}</span>
                    </div>
                    <div class="ps-stat">
                        <i class="fas fa-gauge ps-stat-icon" />
                        <span>{{ sensitivity }}</span>
                    </div>
                    <div v-if="transmissionPower" class="ps-stat">
                        <i class="fas fa-signal ps-stat-icon" />
                        <span>{{ transmissionPower }}</span>
                    </div>
                </div>
            </div>
        </template>
        <template #badges>
            <span v-if="!sensorEnabled" class="pz-badge-off" title="Sensor disabled">
                <i class="fas fa-eye-slash" />
            </span>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- ═══ sensor 2×2 ═══ -->
    <CardShell
        v-else-if="isSensorCard"
        type="presence"
        :name="entity.name"
        icon="fas fa-radar"
        size="2x2"
        :is-on="anyOccupied"
        :is-offline="isOffline"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="ps-full">
                <!-- People: just the number when present, else "No presence" -->
                <div class="ps-full-hero" :class="anyOccupied ? 'pz-state--on' : 'pz-state--off'">
                    <div v-if="anyOccupied" class="ps-full-count">{{ totalPeople }}</div>
                    <div v-else class="ps-full-empty">No presence</div>
                </div>
                <!-- Light badge -->
                <div v-if="illumination" class="ps-light">
                    <span class="pz-ill-pill" :class="`pz-ill--${illumination}`">
                        <i :class="illuminationIcon" /> {{ illuminationLabel }}
                    </span>
                </div>
                <!-- Zones -->
                <div v-if="subZones.length" class="ps-zone-chips">
                    <span v-for="zone in subZones" :key="zone.id" class="ps-zone-chip" :class="zone.occupied ? 'ps-zone-chip--on' : ''">
                        <span class="ps-zone-dot" :style="{background: zoneColor(zone.color)}" />
                        {{ zone.name || `Zone ${zone.id}` }}
                        <b>{{ zone.occupied ? (zone.numObjects ?? 0) : 0 }}</b>
                    </span>
                </div>
                <!-- Detection setup -->
                <div class="ps-full-grid">
                    <div class="ps-grid-item"><span class="ps-grid-l">Detect height</span><span class="ps-grid-v">{{ detectionRange ?? '—' }}</span></div>
                    <div class="ps-grid-item"><span class="ps-grid-l">Sensitivity</span><span class="ps-grid-v ps-cap">{{ sensitivity }}</span></div>
                    <div v-if="transmissionPower" class="ps-grid-item"><span class="ps-grid-l">Power</span><span class="ps-grid-v ps-cap">{{ transmissionPower }}</span></div>
                    <div class="ps-grid-item"><span class="ps-grid-l">Mount</span><span class="ps-grid-v ps-cap">{{ sensorPosition }}</span></div>
                    <div v-if="sensorHeight != null" class="ps-grid-item"><span class="ps-grid-l">Sensor height</span><span class="ps-grid-v">{{ sensorHeight }} m</span></div>
                    <div v-if="sensorTilt != null" class="ps-grid-item"><span class="ps-grid-l">Tilt</span><span class="ps-grid-v">{{ sensorTilt }}°</span></div>
                    <div v-if="maxPeople != null" class="ps-grid-item"><span class="ps-grid-l">Max people</span><span class="ps-grid-v">{{ maxPeople }}</span></div>
                </div>
            </div>
        </template>
        <template #badges>
            <span v-if="!sensorEnabled" class="pz-badge-off" title="Sensor disabled">
                <i class="fas fa-eye-slash" />
            </span>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- ═══════════════════════════════════════════════════════════════════
         ZONE CARDS (presencezone entity) — radar map
    ═══════════════════════════════════════════════════════════════════ -->

    <!-- ═══ zone 1×1: state + count ═══ -->
    <CardShell
        v-else-if="size === '1x1'"
        type="presencezone"
        :name="entity.name"
        icon="fas fa-person"
        size="1x1"
        :is-on="isOccupied"
        :is-offline="isOffline"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="pz-mini" :class="isOccupied ? 'pz-state--on' : 'pz-state--off'">
                <div class="pz-mini-circle">
                    <div class="pz-mini-circle-bg" :class="isOccupied ? 'pz-circle--on' : 'pz-circle--off'">
                        <i class="fas fa-person pz-mini-icon" />
                    </div>
                    <span v-if="isOccupied && numObjects > 0" class="pz-mini-badge">{{ numObjects }}</span>
                </div>
                <div class="pz-mini-text">
                    <div class="pz-mini-label">{{ isOccupied ? 'Occupied' : 'Empty' }}</div>
                </div>
                <div v-if="illumination" class="pz-ill-pill" :class="`pz-ill--${illumination}`">
                    <i :class="illuminationIcon" />
                    <span>{{ illuminationLabel }}</span>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- ═══ zone 2×1: state + mini radar ═══ -->
    <CardShell
        v-else-if="size === '2x1'"
        type="presencezone"
        :name="entity.name"
        icon="fas fa-radar"
        size="2x1"
        :is-on="isOccupied"
        :is-offline="isOffline"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="pz-wide">
                <div class="pz-wide-left" :class="isOccupied ? 'pz-state--on' : 'pz-state--off'">
                    <div class="pz-wide-label">{{ isOccupied ? 'Occupied' : 'Empty' }}</div>
                    <div class="pz-wide-count">{{ isOccupied && numObjects > 0 ? `${numObjects} ${numObjects === 1 ? 'person' : 'people'}` : 'No presence' }}</div>
                    <div v-if="illumination" class="pz-ill-pill" :class="`pz-ill--${illumination}`">
                        <i :class="illuminationIcon" />
                        <span>{{ illuminationLabel }}</span>
                    </div>
                </div>
                <div class="pz-wide-right">
                    <PresenceRadarMap
                        :zones="radarZones"
                        :objects="trackedObjects"
                        :blind-spots="blindSpots"
                        :highlight-zone-id="isMainZone ? null : zoneId"
                        :sensor-position="sensorPosition"
                        :zmin="presenceConfig?.zmin ?? 0"
                        :zmax="presenceConfig?.zmax ?? 3"
                        compact
                    />
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- ═══ zone 2×2: radar overview + stats ═══ -->
    <CardShell
        v-else
        type="presencezone"
        :name="entity.name"
        icon="fas fa-person"
        size="2x2"
        :is-on="isOccupied"
        :is-offline="isOffline"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="pz-radar-full">
                <PresenceRadarMap
                    :zones="radarZones"
                    :objects="trackedObjects"
                    :blind-spots="blindSpots"
                    :highlight-zone-id="isMainZone ? null : zoneId"
                    :sensor-position="sensorPosition"
                    :zmin="presenceConfig?.zmin ?? 0"
                    :zmax="presenceConfig?.zmax ?? 3"
                    hide-legend
                />
                <div class="pz-radar-meta">
                    <span class="pz-radar-range">0 – {{ detectionRangeMax }}m</span>
                    <span v-if="illumination" class="pz-radar-light">
                        <i :class="[illuminationIcon, `pz-ill-icon--${illumination}`]" /> {{ illuminationLabel }}
                    </span>
                    <span v-if="trackedObjects.length > 0" class="pz-radar-count">
                        {{ trackedObjects.length }} {{ trackedObjects.length === 1 ? 'person' : 'people' }}
                    </span>
                </div>
            </div>
        </template>

        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>

    </CardShell>
</template>

<script setup lang="ts">
import {computed, onUnmounted, ref, watch} from 'vue';
import PresenceRadarMap from '@/components/core/PresenceRadarMap.vue';
import {useDevicesStore} from '@/stores/devices';
import {
    addPresenceTrackListener,
    type PresenceTrackObject,
    sendRPC
} from '@/tools/websocket';
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

const device = computed(() => deviceStore.devices[props.entity.source]);
const isOffline = computed(() => !device.value?.online);
const shellyID = computed(() => device.value?.shellyID ?? props.entity.source);
const zoneId = computed(() => props.entity.properties?.id ?? 200);

// ── Card type detection ───────────────────────────────────────────────────
const isSensorCard = computed(() => props.entity.type === 'presence');
const isMainZone = computed(() => {
    if (isSensorCard.value) return false;
    const mainZoneKey = presenceConfig.value?.main_zone;
    return mainZoneKey === `presencezone:${zoneId.value}`;
});

// ── Device data ───────────────────────────────────────────────────────────
const zoneStatus = computed(() => {
    const s = device.value?.status?.[`presencezone:${zoneId.value}`];
    return s as {value: boolean; num_objects: number} | null;
});

const zoneConfig = computed(() => {
    const c = device.value?.settings?.[`presencezone:${zoneId.value}`];
    return c as {name: string | null; enable: boolean} | null;
});

const presenceConfig = computed(() => {
    const s = device.value?.settings;
    const c = s?.['presence:0'] ?? s?.presence;
    return c as {
        enable: boolean;
        zmin: number | null;
        zmax: number | null;
        main_zone?: string;
        num_tracks?: number;
        sensor: {
            sensitivity: string;
            position?: string;
            power?: string;
            height?: number;
            tilt?: number;
        };
    } | null;
});

const illuminanceStatus = computed(() => {
    const s = device.value?.status?.['illuminance:0'];
    return s as {
        illumination: 'dark' | 'twilight' | 'bright' | null;
        lux?: number;
    } | null;
});

// Zone-specific state
const isOccupied = computed(() => zoneStatus.value?.value === true);
const numObjects = computed(() => zoneStatus.value?.num_objects ?? 0);
const zoneName = computed(() => zoneConfig.value?.name ?? props.entity.name);

// Sensor-wide state — use main zone count (covers entire room, avoids double-counting overlapping zones)
const mainZoneKey = computed(
    () => presenceConfig.value?.main_zone ?? 'presencezone:200'
);
const mainZoneStatus = computed(
    () => device.value?.status?.[mainZoneKey.value]
);
const anyOccupied = computed(() => mainZoneStatus.value?.value === true);
const totalPeople = computed(() =>
    anyOccupied.value ? (mainZoneStatus.value?.num_objects ?? 0) : 0
);

const sensorEnabled = computed(() => presenceConfig.value?.enable ?? false);
const illumination = computed(
    () => illuminanceStatus.value?.illumination ?? null
);
const lux = computed(() => illuminanceStatus.value?.lux ?? null);
const sensitivity = computed(
    () => presenceConfig.value?.sensor?.sensitivity ?? '—'
);
// Transmission power (sensor.power, e.g. "high"). Needs the backend to include
// it in the slim presence settings before it shows on the dashboard.
const transmissionPower = computed(
    () => presenceConfig.value?.sensor?.power ?? null
);
const maxPeople = computed(() => presenceConfig.value?.num_tracks ?? null);
const sensorHeight = computed(() => presenceConfig.value?.sensor?.height ?? null);
const sensorTilt = computed(() => presenceConfig.value?.sensor?.tilt ?? null);
const detectionRangeMax = computed(() => presenceConfig.value?.zmax ?? 3);
const sensorPosition = computed(
    () => presenceConfig.value?.sensor?.position ?? 'center'
);

const blindSpots = computed(() => {
    const s = device.value?.settings;
    const cfg = s?.['presence:0'] ?? s?.presence;
    return (cfg?.blind as number[][] | undefined) ?? [];
});

// ── Zone computeds ────────────────────────────────────────────────────────

// This zone only — for individual zone cards
const thisZone = computed(() => {
    const cfg = device.value?.settings?.[`presencezone:${zoneId.value}`];
    const st = device.value?.status?.[`presencezone:${zoneId.value}`];
    if (!cfg?.area?.length) return [];
    return [
        {
            id: zoneId.value,
            name: cfg.name ?? undefined,
            color: cfg.color ?? undefined,
            area: cfg.area,
            occupied: st?.value === true,
            numObjects: st?.num_objects ?? 0
        }
    ];
});

// All zones — for main zone overview
const allZones = computed(() => {
    const st = device.value?.status;
    const cfg = device.value?.settings;
    if (!st || !cfg) return [];
    const zones: any[] = [];
    for (const key of Object.keys(cfg)) {
        if (!key.startsWith('presencezone:')) continue;
        const zc = cfg[key];
        if (!zc?.area?.length) continue;
        const id = zc.id ?? Number.parseInt(key.split(':')[1], 10);
        const zs = st[key];
        zones.push({
            id,
            name: zc.name ?? undefined,
            color: zc.color ?? undefined,
            area: zc.area,
            occupied: zs?.value === true,
            numObjects: zs?.num_objects ?? 0
        });
    }
    return zones;
});

// Main zone → sub-zones only (main zone covers entire room, redundant as polygon)
// Regular zone → only its own zone
const mainZoneId = computed(() => {
    const key = presenceConfig.value?.main_zone;
    return key ? Number.parseInt(key.split(':')[1], 10) : 200;
});
const subZones = computed(() =>
    allZones.value.filter((z) => z.id !== mainZoneId.value)
);
const radarZones = computed(() =>
    isMainZone.value ? subZones.value : thisZone.value
);

const detectionRange = computed(() => {
    const c = presenceConfig.value;
    if (!c) return null;
    return `${c.zmin ?? 0}–${c.zmax ?? 3} m`;
});

function zoneColor(color?: number[]): string {
    if (!color || color.length < 3) return 'rgba(var(--color-primary-rgb),0.7)';
    return `rgba(${color[0]},${color[1]},${color[2]},0.7)`;
}

// ── Illumination helpers ──────────────────────────────────────────────────
const ILLUMINATION_ICONS: Record<string, string> = {
    dark: 'fas fa-moon',
    twilight: 'fas fa-cloud-sun',
    bright: 'fas fa-sun'
};
const ILLUMINATION_LABELS: Record<string, string> = {
    dark: 'Dark',
    twilight: 'Twilight',
    bright: 'Bright'
};
const illuminationIcon = computed(() =>
    illumination.value
        ? (ILLUMINATION_ICONS[illumination.value] ?? 'fas fa-lightbulb')
        : ''
);
const illuminationLabel = computed(() =>
    illumination.value
        ? (ILLUMINATION_LABELS[illumination.value] ?? illumination.value)
        : null
);

// ── Live radar (only for zone cards, not sensor card) ─────────────────────

const isLive = ref(false);
const trackedObjects = ref<PresenceTrackObject[]>([]);
let removeListener: (() => void) | null = null;
let renewInterval: ReturnType<typeof setInterval> | null = null;

const needsRadar = computed(
    () => !isSensorCard.value && (props.size === '2x1' || props.size === '2x2')
);

watch(sensorEnabled, (enabled) => {
    if (!enabled && isLive.value) stopLive();
});

async function callLiveTrack() {
    const sid = shellyID.value;
    if (!sid || isOffline.value) return;
    try {
        await sendRPC('FLEET_MANAGER', 'Presence.LiveTrack', {shellyID: sid});
    } catch {
        /* ignore */
    }
}

function startLive() {
    const sid = shellyID.value;
    if (!sid) return;
    isLive.value = true;
    trackedObjects.value = [];
    callLiveTrack();
    renewInterval = setInterval(callLiveTrack, 55_000);
    removeListener = addPresenceTrackListener(sid, (objects) => {
        trackedObjects.value = objects;
    });
}

function stopLive() {
    isLive.value = false;
    trackedObjects.value = [];
    if (renewInterval !== null) {
        clearInterval(renewInterval);
        renewInterval = null;
    }
    removeListener?.();
    removeListener = null;
}

watch(
    [isOffline, needsRadar, sensorEnabled],
    ([offline, radar, enabled]) => {
        if ((offline || !enabled) && isLive.value) {
            stopLive();
        } else if (!offline && !isLive.value && enabled && radar) {
            startLive();
        }
    },
    {immediate: true}
);

onUnmounted(stopLive);
</script>

<style scoped>
/* ══════════════════════════════════════════
   Shared
══════════════════════════════════════════ */
.pz-state--on { color: rgb(var(--ar)); }
.pz-state--off { color: var(--color-text-tertiary); }

/* ══════════════════════════════════════════
   1×1 (shared between sensor & zone)
══════════════════════════════════════════ */
.pz-mini {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    height: 100%;
    padding: var(--space-4) var(--space-3);
}
.pz-mini-circle { position: relative; }
.pz-mini-circle-bg {
    width: 56px; height: 56px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
}
.pz-mini-circle-bg.pz-circle--on  { background: rgba(var(--ar), .1); }
.pz-mini-circle-bg.pz-circle--off { background: rgba(var(--ar), .05); }
.pz-mini-icon { font-size: var(--type-subheading); flex-shrink: 0; }
.pz-state--off .pz-mini-icon { opacity: .5; }
.pz-mini-badge {
    position: absolute; top: calc(-1 * var(--space-1)); right: calc(-1 * var(--space-1-5));
    min-width: 20px; height: 20px; border-radius: 50%;
    background: rgb(var(--ar)); color: var(--color-text-primary);
    font-size: var(--type-body); font-weight: 700;
    display: flex; align-items: center; justify-content: center; padding: 0 3px;
}
.pz-mini-text {
    display: flex; flex-direction: column; align-items: center; gap: var(--space-0-5); text-align: center;
}
.pz-mini-label { font-size: var(--type-subheading); font-weight: 800; letter-spacing: -.5px; line-height: 1; }
/* 1x1: breathing room between the state label and the light pill. */
.pz-mini .pz-ill-pill { margin-top: var(--space-3); }
.pz-mini-sub { font-size: var(--type-body); }
.pz-state--on .pz-mini-sub { color: var(--color-text-tertiary); }
.pz-state--off .pz-mini-sub { color: var(--color-text-disabled); opacity: .7; }
.pz-badge-off { font-size: var(--type-body); color: var(--color-text-tertiary); opacity: 0.6; }

/* ══════════════════════════════════════════
   Sensor 2×1 — stats wide
══════════════════════════════════════════ */
.ps-wide {
    display: flex; align-items: stretch; height: 100%; gap: 0;
}
.ps-wide-hero {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    flex: 0 0 38%; text-align: center;
}
.ps-wide-count { font-size: var(--type-heading); font-weight: 800; line-height: 1; letter-spacing: -1px; }
.ps-wide-unit { font-size: var(--type-body); font-weight: 600; color: var(--color-text-tertiary); margin-top: var(--space-0-5); }
.ps-wide-stats {
    flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 0;
    border-left: 1px solid rgba(var(--color-chart-axis-rgb), .06);
    padding: var(--space-2);
}
.ps-stat {
    display: flex; align-items: center; gap: var(--space-1-5);
    font-size: var(--type-body); font-weight: 600; color: var(--color-text-secondary);
    padding: var(--space-1) var(--space-2);
}
.ps-stat-icon { font-size: var(--type-body); color: var(--color-text-tertiary); width: 14px; text-align: center; }

/* ══════════════════════════════════════════
   Sensor 2×2 — stats full
══════════════════════════════════════════ */
.ps-full {
    display: flex; flex-direction: column; height: 100%;
    padding: var(--space-4);
    gap: var(--space-3);
    justify-content: flex-start;
    position: relative;
    container-type: inline-size;
}
.ps-full-hero {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center;
    margin-top: var(--space-4);
    height: 6rem;          /* fixed so the big number never pushes content below */
    flex-shrink: 0;
}
.ps-full-count { font-size: clamp(60px, 44cqi, 88px); font-weight: 800; line-height: 1; letter-spacing: -2px; }
.ps-full-unit { font-size: var(--type-body); font-weight: 600; color: var(--color-text-tertiary); margin-top: var(--space-1); }

/* Stats as a clean 2-column key/value list — lighter than boxed buttons,
   hairline-separated so the four read as one block. */
.ps-full-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 0 var(--space-5);
}
.ps-grid-item {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: var(--space-2); padding: var(--space-2) 0;
    border-bottom: 1px solid rgba(var(--color-chart-axis-rgb), .07);
}
.ps-grid-v { font-size: var(--type-body); font-weight: 700; color: var(--color-text-primary); }
.ps-grid-l { font-size: var(--type-caption); font-weight: 600; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; }
.ps-cap { text-transform: capitalize; }
/* Light badge right-aligned, sitting just above the zones. */
.ps-light { display: flex; justify-content: flex-end; margin-top: var(--space-2); }
.ps-full-empty { font-size: var(--type-subheading); font-weight: 700; color: var(--color-text-tertiary); }

.ps-zone-chips {
    display: flex; flex-wrap: wrap; gap: var(--space-2); justify-content: center; align-items: center;
    border-top: 1px solid rgba(var(--color-chart-axis-rgb), .06);
    border-bottom: 1px solid rgba(var(--color-chart-axis-rgb), .06);
    margin-top: var(--space-2);
    padding: var(--space-3) 0;
}
.ps-zone-chip {
    display: inline-flex; align-items: center; gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2); border-radius: var(--radius-full);
    background: rgba(var(--color-chart-axis-rgb), .06);
    font-size: var(--type-caption); font-weight: 600; color: var(--color-text-secondary);
}
.ps-zone-chip--on { background: rgba(var(--color-success-rgb), .12); color: var(--color-text-primary); }
.ps-zone-chip b { color: var(--color-text-tertiary); }
.ps-zone-chip--on b { color: rgba(var(--color-success-rgb), .9); }
.ps-zone-dot { width: 8px; height: 8px; border-radius: var(--radius-xs); flex-shrink: 0; }

/* ══════════════════════════════════════════
   Zone 2×1 — radar
══════════════════════════════════════════ */
.pz-wide {
    display: flex; align-items: stretch; height: 100%; gap: 0;
}
.pz-wide-left {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: var(--space-3); flex: 0 0 42%; min-width: 0; text-align: center;
}
.pz-wide-label { font-size: var(--type-subheading); font-weight: 800; line-height: 1; letter-spacing: -.5px; }
.pz-wide-count { font-size: var(--type-body); font-weight: 600; color: var(--color-text-secondary); }
.pz-wide-right {
    flex: 1; overflow: hidden;
    border-left: 1px solid rgba(var(--color-chart-axis-rgb), .06);
    background: rgba(10, 16, 28, 0.9);
    display: flex; align-items: center; justify-content: center;
}

/* ══════════════════════════════════════════
   Zone 2×2 — radar full
══════════════════════════════════════════ */
.pz-radar-full {
    flex: 1; width: 100%; min-height: 0; overflow: hidden;
    background: rgba(10, 16, 28, 0.9);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
}
.pz-radar-meta {
    display: flex; align-items: center; justify-content: space-between;
    width: 100%; padding: var(--space-0-5) var(--space-2); gap: var(--space-2);
}
.pz-radar-range { font-size: var(--type-body); color: var(--color-text-tertiary); }
.pz-radar-zone { font-size: var(--type-body); color: var(--color-text-secondary); font-weight: 600; flex: 1; text-align: center; }
.pz-radar-count { font-size: var(--type-body); color: rgb(var(--ar)); font-weight: 600; }
.pz-radar-light { display: inline-flex; align-items: center; gap: var(--space-1); font-size: var(--type-body); color: var(--color-text-tertiary); white-space: nowrap; }

/* ══════════════════════════════════════════
   Illumination pills
══════════════════════════════════════════ */
.pz-ill-pill {
    display: inline-flex; align-items: center; gap: var(--space-1);
    font-size: var(--type-body); font-weight: 600;
    padding: var(--space-0-5) var(--space-2); border-radius: var(--radius-full); border: 1px solid transparent;
}
.pz-ill--dark    { background: rgba(var(--color-data-presence-rgb),.1);  color: rgb(129,140,248); border-color: rgba(var(--color-data-presence-rgb),.2); }
.pz-ill--twilight{ background: rgba(var(--color-warning-rgb),.1);  color: rgb(251,191,36);  border-color: rgba(var(--color-warning-rgb),.2); }
.pz-ill--bright  { background: rgba(234,179,8,.12);  color: rgb(250,204,21);  border-color: rgba(234,179,8,.25); }
.pz-ill-icon--dark     { color: rgb(129,140,248); margin-right: var(--space-0-5); }
.pz-ill-icon--twilight { color: rgb(251,191,36);  margin-right: var(--space-0-5); }
.pz-ill-icon--bright   { color: rgb(250,204,21);  margin-right: var(--space-0-5); }
</style>

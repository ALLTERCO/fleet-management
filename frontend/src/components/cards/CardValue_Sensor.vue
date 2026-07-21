<template>
    <!-- 1×1 -->
    <CardShell
        v-if="size === '1x1'"
        :type="variant"
        :name="entity.name"
        :icon="icon"
        size="1x1"
        :is-on="isActive"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :is-warning="isCableError"
        :edit-mode="editMode"
        :allowed-sizes="allowedSizes"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <!-- BTHome moisture: droplet icon + big % value, centered like the
                 battery card. No bar. -->
            <template v-if="isMoisture">
                <div class="ec-moist-1x1">
                    <svg width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="1.5" class="ec-moist-icon">
                        <path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"/>
                    </svg>
                    <div class="ec-moist-v">{{ valueDisplay }}<span class="ec-moist-u">%</span></div>
                </div>
            </template>

            <!-- BTHome distance: value + bar -->
            <template v-else-if="isDistanceOrMoisture">
                <div class="ec-dist-1x1">
                    <div class="ec-dist-v">{{ valueDisplay }}</div>
                    <div class="ec-dist-u">{{ unitDisplay }}</div>
                    <div class="ec-dist-bar">
                        <div class="ec-dist-bar-fill" :style="{ width: distBarPct + '%' }"></div>
                    </div>
                </div>
            </template>

            <!-- Pressure: value + arc gauge -->
            <template v-else-if="variant === 'pressure'">
                <div class="ec-gauge-1x1">
                    <svg class="ec-gauge-arc" viewBox="0 0 120 70">
                        <defs><linearGradient id="gaugeGrad"><stop offset="0%" stop-color="#38bdf8" /><stop offset="100%" stop-color="#818cf8" /></linearGradient></defs>
                        <path d="M12 62 A 48 48 0 0 1 108 62" fill="none" stroke="rgba(148,163,184,0.1)" stroke-width="8" stroke-linecap="round" />
                        <path d="M12 62 A 48 48 0 0 1 108 62" fill="none" stroke="url(#gaugeGrad)" stroke-width="8" stroke-linecap="round" :stroke-dasharray="gaugeCirc" :stroke-dashoffset="gaugeOffset" />
                        <line x1="60" y1="62" :x2="gaugeNeedleX" :y2="gaugeNeedleY" stroke="var(--color-text-primary)" stroke-width="2" stroke-linecap="round" opacity=".8" />
                        <circle cx="60" cy="62" r="4" fill="var(--color-text-secondary)" />
                        <text x="14" y="68" fill="var(--color-text-quaternary)" font-size="6" font-weight="600">{{ pressureMin }}</text>
                        <text x="96" y="68" fill="var(--color-text-quaternary)" font-size="6" font-weight="600">{{ pressureMax }}</text>
                    </svg>
                    <div class="ec-gauge-val">{{ valueDisplay }}</div>
                    <div class="ec-gauge-unit">{{ unitDisplay }}</div>
                </div>
            </template>

            <!-- UV Index: 5-segment color band + indicator dot -->
            <template v-else-if="variant === 'uv'">
                <div class="ec-uv-1x1">
                    <div class="ec-uv-val" :style="{ color: uvColor }">{{ valueDisplay }}</div>
                    <div class="ec-uv-label" :style="{ color: uvColor }">{{ uvLabel }}</div>
                    <div class="ec-uv-band">
                        <div class="ec-uv-seg ec-uv-seg--low"></div>
                        <div class="ec-uv-seg ec-uv-seg--moderate"></div>
                        <div class="ec-uv-seg ec-uv-seg--high"></div>
                        <div class="ec-uv-seg ec-uv-seg--very-high"></div>
                        <div class="ec-uv-seg ec-uv-seg--extreme"></div>
                    </div>
                    <div class="ec-uv-dot-track">
                        <div class="ec-uv-dot" :style="{ left: uvBarPct + '%', background: uvColor, boxShadow: '0 0 4px ' + uvColor }"></div>
                    </div>
                </div>
            </template>

            <!-- Wind: full compass with direction + speed -->
            <template v-else-if="variant === 'wind'">
                <div class="ec-wind-1x1">
                    <div class="ec-wind-compass">
                        <svg viewBox="0 0 80 80" class="ec-wind-svg">
                            <circle cx="40" cy="40" r="35" fill="none" stroke="rgba(148,163,184,0.1)" stroke-width="1.5" />
                            <!-- Cardinal labels -->
                            <text x="40" y="10" text-anchor="middle" fill="rgba(148,163,184,0.5)" font-size="8" font-weight="700">N</text>
                            <text x="40" y="76" text-anchor="middle" fill="rgba(148,163,184,0.25)" font-size="7" font-weight="600">S</text>
                            <text x="8" y="43" text-anchor="middle" fill="rgba(148,163,184,0.25)" font-size="7" font-weight="600">W</text>
                            <text x="72" y="43" text-anchor="middle" fill="rgba(148,163,184,0.25)" font-size="7" font-weight="600">E</text>
                            <!-- Tick marks -->
                            <line x1="40" y1="7" x2="40" y2="11" stroke="rgba(148,163,184,.2)" stroke-width="1" />
                            <line x1="40" y1="69" x2="40" y2="73" stroke="rgba(148,163,184,.15)" stroke-width="1" />
                            <line x1="7" y1="40" x2="11" y2="40" stroke="rgba(148,163,184,.15)" stroke-width="1" />
                            <line x1="69" y1="40" x2="73" y2="40" stroke="rgba(148,163,184,.15)" stroke-width="1" />
                            <!-- Arrow with arrowhead -->
                            <line x1="40" y1="40" :x2="windArrowX80" :y2="windArrowY80" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" />
                            <circle cx="40" cy="40" r="3" fill="#38bdf8" />
                        </svg>
                    </div>
                    <div class="ec-wind-val">{{ valueDisplay }}<span>{{ unitDisplay }}</span> <span class="ec-wind-dir">{{ windDirLabel }}</span></div>
                </div>
            </template>

            <!-- Rain: raindrop fill -->
            <template v-else-if="variant === 'rain'">
                <div class="ec-rain-1x1">
                    <i class="fas fa-cloud-rain ec-rain-icon"></i>
                    <div class="ec-rain-val">{{ valueDisplay }}<span>{{ unitDisplay }}</span></div>
                </div>
            </template>

            <!-- Channel: numbered badge -->
            <template v-else-if="variant === 'channel'">
                <div class="ec-chan-1x1">
                    <div class="ec-chan-badge">{{ valueDisplay }}</div>
                    <div class="ec-chan-label">Channel</div>
                </div>
            </template>

            <!-- Other analog sensors: value + unit. Voltage is a single reading,
                 shown large but sized to fit the tile. -->
            <template v-else-if="isAnalog">
                <div class="ec-hv-wrap" :class="{'ec-hv-wrap--lg': variant === 'voltage'}">
                    <span class="ec-hv" :class="{'ec-hv--lg': variant === 'voltage'}">{{ valueDisplay }}</span>
                    <span class="ec-hu">{{ unitDisplay }}</span>
                </div>
                <div v-if="subDisplay" class="ec-sub">{{ subDisplay }}</div>
            </template>

            <!-- Binary sensors: SVG icon + state + sub-line -->
            <template v-else>
                <!-- Flood: water droplet -->
                <svg v-if="variant === 'flood'" width="44" height="44" viewBox="0 0 24 24" fill="none" :stroke="isActive ? 'var(--color-status-off)' : 'var(--color-status-on)'" stroke-width="1.5" :style="{ opacity: isActive ? 1 : 0.5 }">
                    <path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z" :fill="isActive ? 'rgba(192,41,61,.1)' : 'none'" />
                    <template v-if="isActive"><line x1="3" y1="16" x2="21" y2="16" stroke-dasharray="3 2" opacity=".5" /><line x1="3" y1="19" x2="21" y2="19" stroke-dasharray="3 2" opacity=".3" /></template>
                </svg>
                <!-- Motion: walking figure -->
                <svg v-else-if="variant === 'motion'" width="44" height="44" viewBox="0 0 24 24" fill="none" :stroke="isActive ? 'var(--color-warning-text)' : 'var(--color-status-on)'" stroke-width="1.5" :style="{ opacity: isActive ? 1 : 0.5 }">
                    <circle cx="12" cy="5" r="2" /><path d="M4 17l3-3 2 2 4-4 2 2 3-3" /><path d="M17 10v4h4" />
                </svg>
                <!-- Smoke: checkmark or smoke -->
                <svg v-else-if="variant === 'smoke'" width="44" height="44" viewBox="0 0 24 24" fill="none" :stroke="isActive ? 'var(--color-status-off)' : 'var(--color-status-on)'" stroke-width="1.5" :style="{ opacity: isActive ? 1 : 0.5 }">
                    <template v-if="isActive"><path d="M8 18c0-3 2-5 2-8a4 4 0 018 0c0 3 2 5 2 8" /><path d="M4 21h16" stroke-linecap="round" /><path d="M12 6V2" /></template>
                    <template v-else><circle cx="12" cy="12" r="10" /><path d="M9 12l2 2 4-4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></template>
                </svg>
                <div role="status" class="ec-state ec-state-lg" :class="stateClass">{{ stateText }}</div>
                <div v-if="binarySub1x1" class="ec-sub ec-sub--sensor">{{ binarySub1x1 }}</div>
            </template>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :battery="battery" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2×1 -->
    <CardShell
        v-else-if="size === '2x1'"
        :type="variant"
        :name="entity.name"
        :icon="icon"
        size="2x1"
        :is-on="isActive"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :is-warning="isCableError"
        :edit-mode="editMode"
        :allowed-sizes="allowedSizes"
        extra-class="ec-sensor"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="ec-split ec-split--40-60">
                <div class="ec-wl">
                    <!-- Binary sensor SVG icons (2x1 left panel) -->
                    <svg v-if="variant === 'flood'" width="48" height="48" viewBox="0 0 24 24" fill="none" :stroke="isActive ? 'var(--color-status-off)' : 'var(--color-status-on)'" stroke-width="1.5" :style="{ opacity: isActive ? 1 : 0.5 }">
                        <path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z" :fill="isActive ? 'rgba(192,41,61,.1)' : 'none'" />
                    </svg>
                    <svg v-else-if="variant === 'motion'" width="48" height="48" viewBox="0 0 24 24" fill="none" :stroke="isActive ? 'var(--color-warning-text)' : 'var(--color-status-on)'" stroke-width="1.5" :style="{ opacity: isActive ? 1 : 0.5 }">
                        <circle cx="12" cy="5" r="2" /><path d="M4 17l3-3 2 2 4-4 2 2 3-3" /><path d="M17 10v4h4" />
                    </svg>
                    <svg v-else-if="variant === 'smoke'" width="48" height="48" viewBox="0 0 24 24" fill="none" :stroke="isActive ? 'var(--color-status-off)' : 'var(--color-status-on)'" stroke-width="1.5" :style="{ opacity: isActive ? 1 : 0.5 }">
                        <template v-if="isActive"><path d="M8 18c0-3 2-5 2-8a4 4 0 018 0c0 3 2 5 2 8" /><path d="M4 21h16" stroke-linecap="round" /></template>
                        <template v-else><circle cx="12" cy="12" r="10" /><path d="M9 12l2 2 4-4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></template>
                    </svg>
                    <div class="ec-sensor-hero" :class="isAnalog ? '' : stateClass">{{ wideHeroValue }}</div>
                    <div class="ec-sensor-hero-sub">{{ wideHeroLabel }}</div>
                </div>
                <div class="ec-wr">
                    <div class="ec-cols">
                        <div v-for="col in wideRightCols" :key="col.label" class="ec-col">
                            <div class="ec-wide-col-v" :class="col.vClass || ''">
                                {{ col.value }}<span v-if="col.unit" class="ec-wide-col-u">{{ col.unit }}</span>
                            </div>
                            <div class="ec-wide-col-l">{{ col.label }}</div>
                        </div>
                    </div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :battery="battery" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2×2 -->
    <CardShell
        v-else
        :type="variant"
        :name="entity.name"
        :icon="icon"
        size="2x2"
        :is-on="isActive"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :is-warning="isCableError"
        :edit-mode="editMode"
        :allowed-sizes="allowedSizes"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <!-- Pressure hero with gauge -->
            <template v-if="variant === 'pressure'">
                <div class="ec-hero-top">
                    <svg class="ec-gauge-arc ec-gauge-arc--hero" viewBox="0 0 100 60">
                        <path d="M10 55 A 40 40 0 0 1 90 55" fill="none" stroke="rgba(148,163,184,0.15)" stroke-width="5" stroke-linecap="round" />
                        <path d="M10 55 A 40 40 0 0 1 90 55" fill="none" stroke="url(#gaugeGradH)" stroke-width="5" stroke-linecap="round" :stroke-dasharray="gaugeCirc" :stroke-dashoffset="gaugeOffset" />
                        <defs><linearGradient id="gaugeGradH"><stop offset="0%" stop-color="#38bdf8" /><stop offset="100%" stop-color="#818cf8" /></linearGradient></defs>
                    </svg>
                    <div class="ec-hero-top-v">{{ valueDisplay }}</div>
                    <div class="ec-hero-top-u">{{ unitDisplay }}</div>
                </div>
                <div class="ec-hero-info">
                    <div class="ec-hero-stat"><div class="ec-hero-stat-v">—</div><div class="ec-hero-stat-l">Min 24h</div></div>
                    <div class="ec-hero-stat"><div class="ec-hero-stat-v">—</div><div class="ec-hero-stat-l">Avg 24h</div></div>
                    <div class="ec-hero-stat"><div class="ec-hero-stat-v">—</div><div class="ec-hero-stat-l">Max 24h</div></div>
                </div>
            </template>

            <!-- UV Index hero with color scale -->
            <template v-else-if="variant === 'uv'">
                <div class="ec-hero-top">
                    <div class="ec-hero-top-v" :style="{ color: uvColor }">{{ valueDisplay }}</div>
                    <div class="ec-hero-top-u">{{ uvLabel }}</div>
                </div>
                <div class="ec-sensor-padded">
                    <div class="ec-uv-bar ec-uv-bar--6">
                        <div class="ec-uv-bar-fill" :style="{ width: uvBarPct + '%', background: uvColor }"></div>
                    </div>
                </div>
                <div class="ec-hero-info">
                    <div class="ec-hero-stat"><div class="ec-hero-stat-v">—</div><div class="ec-hero-stat-l">Min 24h</div></div>
                    <div class="ec-hero-stat"><div class="ec-hero-stat-v">—</div><div class="ec-hero-stat-l">Max 24h</div></div>
                    <div class="ec-hero-stat"><div class="ec-hero-stat-v">{{ battery !== null ? `${battery}%` : '—' }}</div><div class="ec-hero-stat-l">Battery</div></div>
                </div>
            </template>

            <!-- Wind hero with compass -->
            <template v-else-if="variant === 'wind'">
                <div class="ec-hero-top ec-hero-top--center">
                    <svg viewBox="0 0 80 80" class="ec-hero-svg--100">
                        <circle cx="40" cy="40" r="35" fill="none" stroke="rgba(148,163,184,0.15)" stroke-width="1.5" />
                        <text x="40" y="12" text-anchor="middle" fill="rgba(148,163,184,0.5)" font-size="8" font-weight="700">N</text>
                        <text x="72" y="43" text-anchor="middle" fill="rgba(148,163,184,0.3)" font-size="7">E</text>
                        <text x="40" y="74" text-anchor="middle" fill="rgba(148,163,184,0.3)" font-size="7">S</text>
                        <text x="8" y="43" text-anchor="middle" fill="rgba(148,163,184,0.3)" font-size="7">W</text>
                        <line x1="40" y1="40" :x2="windArrowX80" :y2="windArrowY80" stroke="#38bdf8" stroke-width="3" stroke-linecap="round" />
                        <circle cx="40" cy="40" r="3" fill="#38bdf8" />
                    </svg>
                    <div class="ec-hero-top-v">{{ valueDisplay }} {{ unitDisplay }}</div>
                    <div class="ec-hero-top-u">{{ variantLabel }}</div>
                </div>
                <div class="ec-hero-info">
                    <div class="ec-hero-stat"><div class="ec-hero-stat-v">—</div><div class="ec-hero-stat-l">Gust</div></div>
                    <div class="ec-hero-stat"><div class="ec-hero-stat-v">—</div><div class="ec-hero-stat-l">Avg 24h</div></div>
                    <div class="ec-hero-stat"><div class="ec-hero-stat-v">{{ battery !== null ? `${battery}%` : '—' }}</div><div class="ec-hero-stat-l">Battery</div></div>
                </div>
            </template>

            <!-- Rain hero -->
            <template v-else-if="variant === 'rain'">
                <div class="ec-hero-top">
                    <i class="fas fa-cloud-rain ec-hero-rain-icon"></i>
                    <div class="ec-hero-top-v ec-hero-top-v--humidity">{{ valueDisplay }} {{ unitDisplay }}</div>
                    <div class="ec-hero-top-u">Precipitation</div>
                </div>
                <div class="ec-hero-info">
                    <div class="ec-hero-stat"><div class="ec-hero-stat-v">—</div><div class="ec-hero-stat-l">Today</div></div>
                    <div class="ec-hero-stat"><div class="ec-hero-stat-v">—</div><div class="ec-hero-stat-l">Max 24h</div></div>
                    <div class="ec-hero-stat"><div class="ec-hero-stat-v">{{ battery !== null ? `${battery}%` : '—' }}</div><div class="ec-hero-stat-l">Battery</div></div>
                </div>
            </template>

            <!-- Channel hero -->
            <template v-else-if="variant === 'channel'">
                <div class="ec-hero-top ec-hero-top--center">
                    <div class="ec-chan-badge ec-chan-badge--lg">{{ valueDisplay }}</div>
                    <div class="ec-hero-top-u">Active Channel</div>
                </div>
                <div class="ec-hero-info">
                    <div class="ec-hero-stat"><div class="ec-hero-stat-v">{{ battery !== null ? `${battery}%` : '—' }}</div><div class="ec-hero-stat-l">Battery</div></div>
                    <div class="ec-hero-stat"><div class="ec-hero-stat-v">{{ device?.online ? 'OK' : 'OFF' }}</div><div class="ec-hero-stat-l">Link</div></div>
                    <div class="ec-hero-stat"><div class="ec-hero-stat-v">—</div><div class="ec-hero-stat-l">RSSI</div></div>
                </div>
            </template>

            <!-- Other analog hero (humidity, illuminance, energy, generic, bthome analog) -->
            <template v-else-if="isAnalog">
                <div class="ec-hero-top">
                    <div class="ec-hero-top-v">{{ valueDisplay }}{{ unitDisplay ? ' ' + unitDisplay : '' }}</div>
                    <div class="ec-hero-top-u">{{ variantLabel }}</div>
                </div>
                <div class="ec-hero-cols">
                    <div class="ec-hero-col">
                        <div class="ec-hero-col-v">—</div>
                        <div class="ec-hero-col-l">Min 24h</div>
                    </div>
                    <div class="ec-hero-col">
                        <div class="ec-hero-col-v">—</div>
                        <div class="ec-hero-col-l">Avg 24h</div>
                    </div>
                    <div class="ec-hero-col">
                        <div class="ec-hero-col-v">—</div>
                        <div class="ec-hero-col-l">Max 24h</div>
                    </div>
                </div>
                <div class="ec-hero-info">
                    <div class="ec-hero-stat">
                        <div class="ec-hero-stat-v">{{ battery !== null ? `${battery}%` : '—' }}</div>
                        <div class="ec-hero-stat-l">Battery</div>
                    </div>
                    <div class="ec-hero-stat">
                        <div class="ec-hero-stat-v">—</div>
                        <div class="ec-hero-stat-l">Packet ID</div>
                    </div>
                    <div class="ec-hero-stat">
                        <div class="ec-hero-stat-v">—</div>
                        <div class="ec-hero-stat-l">RSSI</div>
                    </div>
                </div>
            </template>

            <!-- Binary sensor hero: door, motion, flood, smoke -->
            <template v-else>
                <div class="ec-hero-top">
                    <div role="status" class="ec-hero-top-v" :class="stateClass">{{ stateText }}</div>
                    <div class="ec-hero-top-u">{{ heroTopSub }}</div>
                </div>
                <div class="ec-hero-cols">
                    <div v-for="col in heroCols" :key="col.label" class="ec-hero-col">
                        <div class="ec-hero-col-v" :class="col.vClass || ''">{{ col.value }}</div>
                        <div class="ec-hero-col-l">{{ col.label }}</div>
                    </div>
                </div>
                <!-- Activity timeline -->
                <div class="ec-sensor-padded--noshrink">
                    <div class="ec-tl-wrap">
                        <div class="ec-tl-bar ec-tl-bar--24">
                            <div class="ec-tl-seg" :style="timelineBarStyle"></div>
                        </div>
                        <div class="ec-tl-axis"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span></div>
                        <div v-if="variant === 'flood' || variant === 'smoke'" class="ec-tl-stats">
                            <div class="ec-tl-stat"><div class="ec-tl-dot ec-tl-dot--on"></div><b>{{ isActive ? stateText : (variant === 'flood' ? 'Dry' : 'Clear') }}</b> all day</div>
                            <div class="ec-tl-stat"><b>—</b> ago checked</div>
                        </div>
                        <div v-else-if="variant === 'presencezone'" class="ec-tl-stats">
                            <div class="ec-tl-stat"><div class="ec-tl-dot ec-tl-dot--on"></div><b>{{ isActive ? 'Occupied' : 'Empty' }}</b> now</div>
                            <div class="ec-tl-stat"><b>—</b> events today</div>
                        </div>
                    </div>
                </div>
                <div class="ec-hero-info">
                    <div v-for="stat in heroStats" :key="stat.label" class="ec-hero-stat">
                        <div class="ec-hero-stat-v" :class="stat.vClass || ''">{{ stat.value }}</div>
                        <div class="ec-hero-stat-l">{{ stat.label }}</div>
                    </div>
                </div>
            </template>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :battery="battery" :shelly-id="entity.source" />
        </template>
    </CardShell>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import type {SensorVariant} from '@/config/bthome-presentation';
import {
    binaryStateClass,
    getBThomeBinaryStateWords,
    getBThomeIcon,
    getBThomeLabel
} from '@/config/bthome-presentation';
import {allowedSizesForEntity} from '@/helpers/widgetCatalog';
import {useDevicesStore} from '@/stores/devices';
import type {entity_t} from '@/types';
import CardBadges from './CardBadges.vue';
import CardShell from './CardShell.vue';

const props = withDefaults(
    defineProps<{
        entity: entity_t;
        size: '1x1' | '2x1' | '2x2';
        variant: SensorVariant;
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
// Feeds the shell's size popover/grip so single-value sensors (illuminance,
// rotation) offer only 1x1 — same rule as everywhere else.
const allowedSizes = computed(() => allowedSizesForEntity(props.entity));
const isOffline = computed(() => !device.value?.online);
const isSleeping = computed(() => !!device.value?.sleeping);
const isBThome = computed(() => props.entity.type === 'bthomesensor');
const isInternalTemp = computed(
    () => props.variant === 'temp' && !!props.entity.properties?.embeddedIn
);

const status = computed(() => {
    if (!device.value) return null;
    const e = props.entity;
    return device.value.status?.[`${e.type}:${e.properties.id}`] ?? null;
});

// Battery: devicepower:0 for native Shelly, or look for a sibling battery bthomesensor
const battery = computed<number | null>(() => {
    if (!device.value?.status) return null;
    const dp = device.value.status['devicepower:0'];
    return dp?.battery?.percent ?? null;
});

// ── Variant classification ──────────────────────────────────────────────

const ANALOG_VARIANTS = new Set<SensorVariant>([
    'temp',
    'humidity',
    'illuminance',
    'energy',
    'voltage',
    'pressure',
    'uv',
    'wind',
    'rain',
    'rotation',
    'channel',
    'generic'
]);
const isAnalog = computed(() => ANALOG_VARIANTS.has(props.variant));

// ── New variant computed properties ────────────────────────────────────

// Pressure gauge (normalize 950-1050 hPa to 0-100%)
const PRESSURE_MIN = 950;
const PRESSURE_MAX = 1050;
const pressureMin = PRESSURE_MIN;
const pressureMax = PRESSURE_MAX;
const gaugeCirc = '151';
const gaugePct = computed(() => {
    const raw = Number(status.value?.value ?? 1013);
    return Math.max(
        0,
        Math.min(1, (raw - PRESSURE_MIN) / (PRESSURE_MAX - PRESSURE_MIN))
    );
});
const gaugeOffset = computed(() => String(151 - gaugePct.value * 151));
// Needle endpoint — arc from (-180°) to (0°) mapped to pct
const gaugeNeedleX = computed(() => {
    const angle = Math.PI * (1 - gaugePct.value);
    return Math.round(60 + 40 * Math.cos(angle));
});
const gaugeNeedleY = computed(() => {
    const angle = Math.PI * (1 - gaugePct.value);
    return Math.round(62 - 40 * Math.sin(angle));
});

// UV index (0-11+ scale)
const uvBarPct = computed(() =>
    Math.min(100, (Number(status.value?.value ?? 0) / 11) * 100)
);
const UV_COLORS = [
    '#4ade80',
    '#a3e635',
    '#facc15',
    '#fb923c',
    '#ef4444',
    '#a855f7'
];
const UV_LABELS = [
    'Low',
    'Low',
    'Moderate',
    'Moderate',
    'Moderate',
    'High',
    'High',
    'Very High',
    'Very High',
    'Very High',
    'Very High',
    'Extreme'
];
const uvColor = computed(() => {
    const idx = Math.min(5, Math.floor(Number(status.value?.value ?? 0) / 2));
    return UV_COLORS[idx];
});
const uvLabel = computed(
    () =>
        UV_LABELS[Math.min(11, Math.round(Number(status.value?.value ?? 0)))] ??
        'Extreme'
);

// Wind direction → arrow endpoint (0° = North)
const windDeg = computed(() => Number(status.value?.value ?? 0));
const windArrowX = computed(() =>
    (30 + 20 * Math.sin((windDeg.value * Math.PI) / 180)).toFixed(1)
);
const windArrowY = computed(() =>
    (30 - 20 * Math.cos((windDeg.value * Math.PI) / 180)).toFixed(1)
);
// 80×80 viewBox variant (center 40, radius 28)
const windArrowX80 = computed(() =>
    Math.round(40 + 28 * Math.sin((windDeg.value * Math.PI) / 180))
);
const windArrowY80 = computed(() =>
    Math.round(40 - 28 * Math.cos((windDeg.value * Math.PI) / 180))
);
const WIND_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
const windDirLabel = computed(
    () => WIND_DIRS[Math.round(windDeg.value / 45) % 8]
);

const DISTANCE_OBJ_NAMES = new Set(['distance_mm', 'distance_m']);
const MOISTURE_OBJ_NAMES = new Set(['moisture']);

const objName = computed(() => props.entity.properties?.objName ?? '');
const isMoisture = computed(
    () => isBThome.value && MOISTURE_OBJ_NAMES.has(objName.value)
);
const isDistanceOrMoisture = computed(
    () =>
        isBThome.value &&
        (DISTANCE_OBJ_NAMES.has(objName.value) || isMoisture.value)
);
const distBarPct = computed(() => {
    const raw = status.value?.value;
    if (raw == null) return 0;
    if (isMoisture.value) return Math.max(0, Math.min(100, Number(raw)));
    // Distance: normalize to 0–5000mm range for the bar fill
    return Math.max(0, Math.min(100, (Number(raw) / 5000) * 100));
});

const ICONS: Record<SensorVariant, string> = {
    temp: 'fas fa-thermometer-half',
    humidity: 'fas fa-droplet-degree',
    door: 'fas fa-door-open',
    motion: 'fas fa-person-walking',
    flood: 'fas fa-droplet-percent',
    smoke: 'fas fa-sensor-fire',
    illuminance: 'fas fa-brightness',
    energy: 'fas fa-bolt',
    voltage: 'fas fa-meter',
    presencezone: 'fas fa-sensor-on',
    battery: 'fas fa-battery-three-quarters',
    pressure: 'fas fa-meter',
    uv: 'fas fa-sun',
    wind: 'fas fa-wind',
    rain: 'fas fa-cloud-rain',
    rotation: 'fas fa-rotate',
    channel: 'fas fa-tower-broadcast',
    generic: 'fas fa-sensor'
};

const VARIANT_LABELS: Record<SensorVariant, string> = {
    temp: 'Temperature',
    humidity: 'Relative Humidity',
    illuminance: 'Illuminance',
    energy: 'Energy',
    voltage: 'Voltage',
    generic: 'Sensor',
    door: 'Door',
    motion: 'Motion',
    flood: 'Flood',
    smoke: 'Smoke',
    presencezone: 'Presence Zone',
    battery: 'Battery',
    pressure: 'Pressure',
    uv: 'UV Index',
    wind: 'Wind',
    rain: 'Precipitation',
    rotation: 'Rotation',
    channel: 'Channel'
};

const icon = computed(() => {
    // BThome: use the objName-specific icon if available
    if (isBThome.value) {
        return getBThomeIcon(props.entity.properties?.objName);
    }
    // Internal temp (PCB temperature): show microchip icon
    if (isInternalTemp.value) return 'fas fa-microchip';
    return ICONS[props.variant];
});

const variantLabel = computed(() => {
    if (isBThome.value) {
        return getBThomeLabel(props.entity.properties?.objName);
    }
    return VARIANT_LABELS[props.variant];
});

// ── Analog value display ────────────────────────────────────────────────

/** Format a numeric value: 1 decimal for floats, integer for whole numbers */
function formatValue(v: any): string {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'number') {
        return Number.isInteger(v) ? String(v) : v.toFixed(1);
    }
    return String(v);
}

// Native Shelly temperature (temperature:N → tC)
const tempDisplay = computed(() => {
    if (isBThome.value) return formatValue(status.value?.value);
    return formatValue(status.value?.tC);
});

// Native Shelly humidity (humidity:N → rh)
const humidityDisplay = computed(() => {
    if (isBThome.value) return formatValue(status.value?.value);
    // Internal temp (PCB) has no humidity sensor — never show humidity
    if (isInternalTemp.value) return null;
    if (props.variant === 'humidity') {
        return formatValue(status.value?.rh);
    }
    // For temp variant, check if device has humidity:0
    if (!device.value?.status) return null;
    const hum = device.value.status['humidity:0'];
    return hum?.rh != null ? String(Math.round(hum.rh)) : null;
});

// BThome generic value (reads status.value for any BThome sensor)
const bthomeValue = computed(() => formatValue(status.value?.value));

/** The main displayed value — picks the right source based on entity type and variant */
const valueDisplay = computed(() => {
    if (isBThome.value) return bthomeValue.value;
    if (props.variant === 'humidity') return humidityDisplay.value ?? '—';
    if (props.variant === 'energy') {
        // Native energy → aenergy.total or similar
        return formatValue(
            status.value?.aenergy?.total ??
                status.value?.apower ??
                status.value?.voltage ??
                status.value?.current ??
                status.value?.value
        );
    }
    if (props.variant === 'voltage') {
        const v = status.value?.voltage ?? status.value?.xvoltage?.voltage;
        return v != null ? Number(v).toFixed(1) : '—';
    }
    return formatValue(status.value?.value);
});

/** The displayed unit — from entity properties or variant defaults */
const unitDisplay = computed(() => {
    // BThome: use the unit from entity properties
    if (isBThome.value) {
        return props.entity.properties?.unit || '';
    }
    // Native Shelly: variant-based defaults
    const defaults: Partial<Record<SensorVariant, string>> = {
        temp: '°C',
        humidity: '%',
        illuminance: 'lux',
        energy: 'W',
        voltage: 'V'
    };
    return defaults[props.variant] ?? '';
});

/** Subtitle for 1x1 analog cards (non-temp, non-binary) */
const subDisplay = computed(() => {
    // For BThome analog or humidity/illuminance/energy/generic that aren't temp
    if (props.variant === 'humidity' && !isBThome.value) {
        // humidity variant might show temp as sub
        return tempDisplay.value !== '—' ? `${tempDisplay.value}°C` : null;
    }
    return null;
});

// ── Binary sensor states ────────────────────────────────────────────────

const BINARY_STATES: Record<
    string,
    {on: string; off: string; onClass: string; offClass: string}
> = {
    door: {on: 'Open', off: 'Closed', onClass: 's-open', offClass: 's-closed'},
    motion: {
        on: 'Motion',
        off: 'Clear',
        onClass: 's-motion',
        offClass: 's-clear'
    },
    flood: {on: 'FLOOD', off: 'Dry', onClass: 's-flood', offClass: 's-dry'},
    smoke: {on: 'ALARM', off: 'Clear', onClass: 's-alarm', offClass: 's-clear'},
    presencezone: {
        on: 'Occupied',
        off: 'Empty',
        onClass: 's-on',
        offClass: 's-off'
    }
};

const isActive = computed(() => {
    const v = props.variant;
    if (isAnalog.value) return false;
    if (isBThome.value) return !!status.value?.value;
    if (v === 'flood') return !!status.value?.alarm;
    if (v === 'smoke') return !!status.value?.smoke;
    if (v === 'motion' || v === 'presencezone') return !!status.value?.value;
    return false;
});

// Flood-specific derived states
const isCableError = computed(
    () =>
        props.variant === 'flood' &&
        Array.isArray(status.value?.errors) &&
        (status.value.errors as string[]).includes('cable_unplugged')
);
const isMuted = computed(
    () => props.variant === 'flood' && !!status.value?.mute
);

const ALARM_MODE_LABELS: Record<string, string> = {
    normal: 'Normal',
    intense: 'Intense',
    rain: 'Rain',
    disabled: 'Disabled'
};

const WAKEUP_LABELS: Record<string, string> = {
    button: 'Button',
    deepsleep_wake: 'Scheduled',
    alarm: 'Alarm',
    powerup: 'Power up'
};

const alarmMode = computed(() => {
    if (props.variant !== 'flood') return null;
    const m = device.value?.settings?.['flood:0']?.alarm_mode;
    return m ? (ALARM_MODE_LABELS[m] ?? m) : null;
});

const floodLastSeen = computed(() => {
    if (props.variant !== 'flood') return null;
    const ts = device.value?.status?.sys?.unixtime ?? device.value?.status?.ts;
    if (!ts) return null;
    const diff = Math.floor(Date.now() / 1000) - ts;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
});

const wakeupReason = computed(() => {
    if (props.variant !== 'flood') return null;
    const cause = device.value?.status?.sys?.wakeup_reason?.cause;
    return cause ? (WAKEUP_LABELS[cause] ?? cause) : null;
});

const batteryVoltage = computed(() => {
    if (props.variant !== 'flood') return null;
    const v = device.value?.status?.['devicepower:0']?.battery?.V;
    return v != null ? `${Number(v).toFixed(2)}V` : null;
});

// Binary state words are presentation, keyed on the backend-sent objName.
const bthomeStateWords = computed(() =>
    getBThomeBinaryStateWords(objName.value)
);

const stateText = computed(() => {
    if (isBThome.value) {
        return isActive.value
            ? bthomeStateWords.value.on
            : bthomeStateWords.value.off;
    }
    if (props.variant === 'flood' && isCableError.value) return 'Fault';
    const cfg = BINARY_STATES[props.variant];
    if (!cfg) return '—';
    return isActive.value ? cfg.on : cfg.off;
});

const stateClass = computed(() => {
    if (isBThome.value) {
        return binaryStateClass(stateText.value, isActive.value);
    }
    if (props.variant === 'flood' && isCableError.value) return 's-fault';
    const cfg = BINARY_STATES[props.variant];
    if (!cfg) return '';
    return isActive.value ? cfg.onClass : cfg.offClass;
});

// ── 1x1 binary sub-line ─────────────────────────────────────────────────

const binarySub1x1 = computed(() => {
    const v = props.variant;
    if (v === 'motion') {
        // Show lux if available
        const lux = device.value?.status?.['illuminance:0']?.lux;
        return lux != null ? `${lux} lux` : '—';
    }
    if (v === 'presencezone') {
        const n = status.value?.num_objects;
        return n != null ? `${n} ${n === 1 ? 'person' : 'people'}` : '—';
    }
    if (v === 'flood') {
        if (isCableError.value) return 'Check cable';
        if (isMuted.value) return 'Muted';
        if (battery.value != null && battery.value < 20)
            return `${battery.value}% batt`;
        return null;
    }
    if (v === 'smoke') {
        return '—';
    }
    return null;
});

// ── Wide card columns (ec-wide-cols) ─────────────────────────────────────

interface WideCol {
    value: string;
    unit?: string;
    label: string;
    vClass?: string;
}

const wideCols = computed<WideCol[]>(() => {
    const v = props.variant;
    const battVal = battery.value !== null ? `${battery.value}` : '—';
    const battUnit = battery.value !== null ? '%' : undefined;

    // BThome analog
    if (isBThome.value && isAnalog.value) {
        return [
            {
                value: bthomeValue.value,
                unit: unitDisplay.value || undefined,
                label: variantLabel.value
            },
            {value: battVal, unit: battUnit, label: 'Battery'},
            {value: device.value?.online ? 'OK' : 'OFF', label: 'Link'}
        ];
    }

    // BThome binary
    if (isBThome.value) {
        return [
            {value: stateText.value, label: 'Status', vClass: stateClass.value},
            {value: battVal, unit: battUnit, label: 'Battery'},
            {value: device.value?.online ? 'OK' : 'OFF', label: 'Link'}
        ];
    }

    // Humidity: Humidity, Temp, Battery
    if (v === 'humidity') {
        return [
            {value: humidityDisplay.value || '—', unit: '%', label: 'Humidity'},
            {value: tempDisplay.value, unit: '°', label: 'Temp'},
            {value: battVal, unit: battUnit, label: 'Battery'}
        ];
    }

    // Energy
    if (v === 'energy') {
        return [
            {
                value: valueDisplay.value,
                unit: undefined,
                label: unitDisplay.value
            },
            {value: battVal, unit: battUnit, label: 'Battery'},
            {value: device.value?.online ? 'OK' : 'OFF', label: 'Link'}
        ];
    }

    // Motion: Status, Lux, Last Motion, Battery
    if (v === 'motion') {
        const lux = device.value?.status?.['illuminance:0']?.lux;
        return [
            {value: stateText.value, label: 'Status', vClass: stateClass.value},
            {value: lux != null ? String(lux) : '—', label: 'Lux'},
            {value: '—', label: 'Last Motion', vClass: 'dim'},
            {value: battVal, unit: battUnit, label: 'Battery'}
        ];
    }

    // Flood: State, Mode, Battery, Last seen
    if (v === 'flood') {
        return [
            {value: stateText.value, label: 'Status', vClass: stateClass.value},
            {value: alarmMode.value ?? '—', label: 'Mode'},
            {value: battVal, unit: battUnit, label: 'Battery'},
            {value: floodLastSeen.value ?? '—', label: 'Last seen'}
        ];
    }

    // Presence zone: Occupied/Empty, People count, Light level
    if (v === 'presencezone') {
        const n = status.value?.num_objects ?? 0;
        const light =
            device.value?.status?.['illuminance:0']?.illumination ?? '—';
        return [
            {value: stateText.value, label: 'Status', vClass: stateClass.value},
            {value: String(n), label: 'People'},
            {value: light, label: 'Light'}
        ];
    }

    // Smoke: Status, Mute, Battery (+ blink on alarm)
    if (v === 'smoke') {
        return [
            {
                value: stateText.value,
                label: 'Status',
                vClass: isActive.value
                    ? `${stateClass.value} blink`
                    : stateClass.value
            },
            {value: '—', label: 'Mute', vClass: 'dim'},
            {value: battVal, unit: battUnit, label: 'Battery'}
        ];
    }

    // Generic fallback
    return [
        {value: stateText.value, label: 'Status', vClass: stateClass.value},
        {value: battVal, unit: battUnit, label: 'Battery'},
        {value: device.value?.online ? 'OK' : 'OFF', label: 'Link'}
    ];
});

// ── 2x1 split layout (hero left + columns right) ─────────────────────────

/** The big hero value for the left side of the 2x1 split */
const wideHeroValue = computed(() => {
    const v = props.variant;
    if (isBThome.value && isAnalog.value)
        return `${bthomeValue.value}${unitDisplay.value ? ` ${unitDisplay.value}` : ''}`;
    if (isBThome.value) return stateText.value;
    if (v === 'humidity') return `${humidityDisplay.value ?? '—'}%`;
    if (v === 'energy') return `${valueDisplay.value} ${unitDisplay.value}`;
    // Binary: state text
    return stateText.value;
});

/** Label under the hero value */
const wideHeroLabel = computed(() => {
    const v = props.variant;
    if (isBThome.value) {
        return isAnalog.value ? variantLabel.value : 'Status';
    }
    if (v === 'humidity') return 'Humidity';
    if (v === 'energy') return 'Power';
    return 'Status';
});

/** Right-side columns for the 2x1 split layout */
const wideRightCols = computed<WideCol[]>(() => {
    const v = props.variant;
    const battVal = battery.value !== null ? `${battery.value}` : '—';
    const battUnit = battery.value !== null ? '%' : undefined;

    if (isBThome.value) {
        return [
            {value: battVal, unit: battUnit, label: 'Battery'},
            {value: device.value?.online ? 'OK' : 'OFF', label: 'Link'}
        ];
    }

    if (v === 'humidity') {
        return [
            {value: tempDisplay.value, unit: '°', label: 'Temp'},
            {value: battVal, unit: battUnit, label: 'Battery'}
        ];
    }
    if (v === 'energy') {
        return [
            {value: battVal, unit: battUnit, label: 'Battery'},
            {value: device.value?.online ? 'OK' : 'OFF', label: 'Link'}
        ];
    }
    if (v === 'motion') {
        const lux = device.value?.status?.['illuminance:0']?.lux;
        return [
            {value: lux != null ? String(lux) : '—', label: 'Lux'},
            {value: battVal, unit: battUnit, label: 'Battery'}
        ];
    }
    if (v === 'flood') {
        return [
            {value: alarmMode.value ?? '—', label: 'Mode'},
            {value: battVal, unit: battUnit, label: 'Battery'},
            {value: floodLastSeen.value ?? '—', label: 'Last seen'}
        ];
    }
    if (v === 'smoke') {
        return [
            {value: '—', label: 'Mute', vClass: 'dim'},
            {value: battVal, unit: battUnit, label: 'Battery'}
        ];
    }
    if (v === 'presencezone') {
        const n = status.value?.num_objects ?? 0;
        const light =
            device.value?.status?.['illuminance:0']?.illumination ?? '—';
        return [
            {value: String(n), label: 'People'},
            {value: light, label: 'Light'}
        ];
    }
    return [
        {value: battVal, unit: battUnit, label: 'Battery'},
        {value: device.value?.online ? 'OK' : 'OFF', label: 'Link'}
    ];
});

// ── 2x2 hero: binary sensor specifics ────────────────────────────────────

/** Subtitle under the hero state value */
const heroTopSub = computed(() => {
    const v = props.variant;
    if (v === 'motion') return '—';
    if (v === 'presencezone') {
        const n = status.value?.num_objects ?? 0;
        return isActive.value
            ? `${n} ${n === 1 ? 'person' : 'people'} detected`
            : 'Nobody here';
    }
    if (v === 'flood') {
        if (isCableError.value) return 'Cable unplugged';
        if (isMuted.value) return 'Alarm muted';
        return isActive.value ? 'Water detected' : 'Sensor OK';
    }
    if (v === 'smoke') return isActive.value ? '—' : 'sensor OK';
    return '—';
});

/** 3 metric columns for binary hero */
interface HeroCol {
    value: string;
    label: string;
    vClass?: string;
}

const heroCols = computed<HeroCol[]>(() => {
    const v = props.variant;
    const battVal = battery.value !== null ? `${battery.value}%` : '—';

    if (v === 'motion') {
        const lux = device.value?.status?.['illuminance:0']?.lux;
        return [
            {value: lux != null ? String(lux) : '—', label: 'Lux'},
            {value: battVal, label: 'Battery'},
            {value: '—', label: 'Events'}
        ];
    }
    if (v === 'flood') {
        return [
            {value: alarmMode.value ?? '—', label: 'Mode'},
            {value: battVal, label: 'Battery'},
            {value: floodLastSeen.value ?? '—', label: 'Last seen'}
        ];
    }
    if (v === 'smoke') {
        return [
            {value: '—', label: 'Mute', vClass: 'dim'},
            {value: battVal, label: 'Battery'},
            {value: '—', label: 'Voltage'}
        ];
    }
    if (v === 'presencezone') {
        const n = status.value?.num_objects ?? 0;
        const light =
            device.value?.status?.['illuminance:0']?.illumination ?? '—';
        const rssi = device.value?.status?.wifi?.rssi;
        return [
            {value: String(n), label: 'People', vClass: n > 0 ? 's-on' : ''},
            {value: light, label: 'Light'},
            {value: rssi != null ? `${rssi} dBm` : '—', label: 'Signal'}
        ];
    }

    // BThome binary / generic fallback
    return [
        {value: battVal, label: 'Battery'},
        {value: device.value?.online ? 'OK' : 'OFF', label: 'Link'},
        {value: '—', label: '—'}
    ];
});

/** Timeline bar background style per variant */
const timelineBarStyle = computed(() => {
    const v = props.variant;
    if (v === 'motion') return 'flex:1;background:rgba(var(--color-data-motion-rgb),.08)';
    if (v === 'flood') return 'flex:1;background:rgba(var(--color-data-flood-rgb),.15)';
    if (v === 'smoke') return 'flex:1;background:rgba(var(--color-danger-rgb),.08)';
    if (v === 'presencezone') return 'flex:1;background:rgba(var(--color-data-presence-rgb),.08)';
    return 'flex:1;background:var(--color-border-default)';
});

/** Stats row for binary hero bottom */
interface HeroStat {
    value: string;
    label: string;
    vClass?: string;
}

const heroStats = computed<HeroStat[]>(() => {
    const v = props.variant;

    if (v === 'motion') {
        return [
            {value: '—', label: 'Peak Hour'},
            {value: '—', label: 'Avg Gap'},
            {value: '—', label: 'Last Motion', vClass: 'dim'},
            {value: '—', label: 'RSSI'}
        ];
    }
    if (v === 'flood') {
        const rssi = device.value?.status?.wifi?.rssi;
        return [
            {
                value: isMuted.value ? 'Muted' : 'Active',
                label: 'Alarm',
                vClass: isMuted.value ? 's-fault' : ''
            },
            {value: wakeupReason.value ?? '—', label: 'Wakeup'},
            {value: batteryVoltage.value ?? '—', label: 'Voltage'},
            {value: rssi != null ? `${rssi} dBm` : '—', label: 'Signal'}
        ];
    }
    if (v === 'smoke') {
        return [
            {value: '—', label: 'Days Clear'},
            {value: '—', label: 'Last Test'},
            {value: '—', label: 'Sensor'},
            {value: '—', label: 'RSSI'}
        ];
    }
    if (v === 'presencezone') {
        const n = status.value?.num_objects ?? 0;
        const light =
            device.value?.status?.['illuminance:0']?.illumination ?? '—';
        const rssi = device.value?.status?.wifi?.rssi;
        return [
            {value: String(n), label: 'People', vClass: n > 0 ? 's-on' : ''},
            {value: light, label: 'Light'},
            {value: rssi != null ? `${rssi} dBm` : '—', label: 'Signal'},
            {value: '—', label: 'Events'}
        ];
    }

    // Generic binary fallback
    return [
        {value: '—', label: 'Events'},
        {
            value: battery.value !== null ? `${battery.value}%` : '—',
            label: 'Battery'
        },
        {value: '—', label: 'RSSI'}
    ];
});
</script>

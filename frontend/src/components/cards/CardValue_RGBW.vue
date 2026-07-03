<template>
    <!-- 1×1: brightness % + sub info -->
    <CardShell
        v-if="size === '1x1'"
        :type="cardType"
        :name="entity.name"
        :icon="cardIcon"
        size="1x1"
        :is-on="isOn"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        :card-style="rgbcStyle"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div role="status" class="ec-dpct">{{ brightnessDisplay }}<span>%</span></div>
            <div v-if="hasPM && isCCT" class="ec-sub ec-sub--sensor">{{ powerDisplay }} {{ powerUnit }} / {{ ctDisplay }}K</div>
            <div v-else-if="hasPM" class="ec-sub ec-sub--sensor">{{ powerDisplay }} {{ powerUnit }} / {{ hexColor }}</div>
            <div v-else-if="isCCT" class="ec-sub ec-sub--sensor">{{ ctDisplay }}K</div>
            <div v-else class="ec-sub ec-sub--sensor">{{ hexColor }}</div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
        <template #toggle>
            <CardToggle :is-on="isOn" :disabled="!canExecute" @toggle="toggle" />
        </template>
    </CardShell>

    <!-- 2×1: 40/60 split — brightness left, slider + toggle right -->
    <CardShell
        v-else-if="size === '2x1'"
        :type="cardType"
        :name="entity.name"
        :icon="cardIcon"
        size="2x1"
        :is-on="isOn"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        :card-style="rgbcStyle"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="ec-wide-row">
                <div class="ec-wl">
                    <div role="status" class="ec-dpct ec-dpct--flush">{{ brightnessDisplay }}<span>%</span></div>
                    <div v-if="hasPM" class="ec-sub--power">{{ powerDisplay }} {{ powerUnit }} / {{ isCCT ? ctDisplay + 'K' : hexColor }}</div>
                    <div v-else class="ec-sub--power">{{ isCCT ? ctDisplay + 'K' : hexColor }}</div>
                </div>
                <div class="ec-wr">
                    <!-- CCT mode: CCT slider + brightness slider -->
                    <template v-if="isCCT">
                        <div class="ec-clr-track">
                            <input
                                type="range"
                                class="sld-r sld-cct"
                                min="0" max="100"
                                :value="cctSliderValue"
                                :disabled="!canExecute"
                                @change="onCctSliderChange"
                                @click.stop
                            />
                        </div>
                    </template>
                    <div class="ec-clr-track">
                        <input
                            type="range"
                            class="sld-r sld-bri"
                            min="0" max="100"
                            :value="brightness"
                            :disabled="!canExecute"
                            @change="onBriSliderChange"
                            @click.stop
                        />
                    </div>
                    <CardToggle :is-on="isOn" :disabled="!canExecute" @toggle="toggle" />
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2×2 BULB hero — dual-mode with RGB/CCT pill toggle -->
    <CardShell
        v-else-if="isBulb"
        type="bulb"
        :name="entity.name"
        icon="fas fa-lightbulb"
        size="2x2"
        :is-on="isOn"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        :card-style="rgbcStyle"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <!-- Mode toggle pill — top left -->
            <div class="bulb-mode-pill">
                <button class="bulb-mp" :class="{act: !isCCT}" :disabled="!canExecute" @click.stop="setMode('rgb')">RGB</button>
                <button class="bulb-mp" :class="{act: isCCT}" :disabled="!canExecute" @click.stop="setMode('cct')">CCT</button>
            </div>

            <!-- Arc area — both arcs, only one visible at a time -->
            <div class="ec-cct-wrap">
                <div v-if="!isCCT" class="ec-cct-arc">
                    <svg viewBox="0 0 200 110" fill="none">
                        <defs>
                            <linearGradient id="bulb-rgb-grad" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stop-color="#FF0000" />
                                <stop offset="17%" stop-color="#FF8800" />
                                <stop offset="33%" stop-color="#FFFF00" />
                                <stop offset="50%" stop-color="#00FF00" />
                                <stop offset="67%" stop-color="#00BFFF" />
                                <stop offset="83%" stop-color="#0000FF" />
                                <stop offset="100%" stop-color="#FF00FF" />
                            </linearGradient>
                        </defs>
                        <path d="M20,100 A80,80 0 0,1 180,100" stroke="url(#bulb-rgb-grad)" stroke-width="10" stroke-linecap="round" />
                        <circle :cx="arcPointerX" :cy="arcPointerY" r="8" :fill="hexColor" stroke="#fff" stroke-width="2" :filter="`drop-shadow(0 0 6px ${hexColor}80)`" />
                    </svg>
                </div>
                <div v-else class="ec-cct-arc">
                    <svg viewBox="0 0 200 110" fill="none">
                        <defs>
                            <linearGradient id="bulb-cct-grad" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stop-color="#FF9329" />
                                <stop offset="50%" stop-color="#FFF4E0" />
                                <stop offset="100%" stop-color="#B4D4FF" />
                            </linearGradient>
                        </defs>
                        <path d="M20,100 A80,80 0 0,1 180,100" stroke="url(#bulb-cct-grad)" stroke-width="10" stroke-linecap="round" />
                        <circle :cx="cctPointerX" :cy="cctPointerY" r="8" :fill="cctPointerColor" stroke="#fff" stroke-width="2" :filter="`drop-shadow(0 0 6px ${cctPointerColor}80)`" />
                    </svg>
                </div>
                <div class="ec-cct-val">
                    <div class="ec-cct-pct">{{ brightnessDisplay }}<span>%</span></div>
                </div>
            </div>

            <!-- Brightness slider -->
            <div class="ec-clr-sliders">
                <div class="ec-clr-srow">
                    <div class="ec-clr-track">
                        <input
                            type="range"
                            class="sld-r sld-bri"
                            min="0" max="100"
                            :value="brightness"
                            :disabled="!canExecute"
                            @change="onBriSliderChange"
                            @click.stop
                        />
                    </div>
                </div>
            </div>

            <!-- RGB preset colors (shown in RGB mode) -->
            <div v-if="!isCCT" class="ec-clr-presets bulb-rgb-row">
                <div
                    v-for="color in colorPresets"
                    :key="color.hex"
                    class="ec-clr-dot"
                    :class="{active: hexColor === color.hex}"
                    :style="{background: color.hex, border: color.hex === '#FFFFFF' ? '1px solid var(--color-border-default)' : undefined}"
                    @click.stop="setColor({r: color.r, g: color.g, b: color.b})"
                />
            </div>

            <!-- CCT presets (shown in CCT mode) -->
            <div v-else class="ec-cct-presets bulb-cct-row">
                <button
                    v-for="preset in cctPresets"
                    :key="preset.kelvin"
                    class="ec-cct-pre"
                    :class="{'ec-cct-pre--active': isNearCCT(preset.kelvin)}"
                    :style="{'--cct-c': preset.color}"
                    :disabled="!canExecute"
                    @click.stop="setCCT(preset.kelvin)"
                >{{ preset.label }}</button>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
        <template #toggle>
            <CardToggle :is-on="isOn" :disabled="!canExecute" @toggle="toggle" />
        </template>
        <template #footer>
            <div class="ec-hero-info">
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ isCCT ? ctDisplay + 'K' : hexColor }}</div>
                    <div class="ec-hero-stat-l">{{ isCCT ? 'CCT' : 'Color' }}</div>
                </div>
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ powerDisplay }} {{ powerUnit }}</div>
                    <div class="ec-hero-stat-l">Power</div>
                </div>
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ tempDisplay }}</div>
                    <div class="ec-hero-stat-l">Temp</div>
                </div>
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ energyDisplay }} kWh</div>
                    <div class="ec-hero-stat-l">Today</div>
                </div>
            </div>
        </template>
    </CardShell>

    <!-- 2×2 RGBW hero — single-mode (RGB or CCT) -->
    <CardShell
        v-else
        type="rgbw"
        :name="entity.name"
        icon="fas fa-palette"
        size="2x2"
        :is-on="isOn"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        :card-style="rgbcStyle"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <!-- Arc visual -->
            <div class="ec-cct-wrap">
                <div class="ec-cct-arc">
                    <!-- RGB rainbow arc -->
                    <svg v-if="!isCCT" viewBox="0 0 200 110" fill="none">
                        <defs>
                            <linearGradient id="rgbw-rgb-grad" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stop-color="#FF0000" />
                                <stop offset="17%" stop-color="#FF8800" />
                                <stop offset="33%" stop-color="#FFFF00" />
                                <stop offset="50%" stop-color="#00FF00" />
                                <stop offset="67%" stop-color="#00BFFF" />
                                <stop offset="83%" stop-color="#0000FF" />
                                <stop offset="100%" stop-color="#FF00FF" />
                            </linearGradient>
                        </defs>
                        <path d="M20,100 A80,80 0 0,1 180,100" stroke="url(#rgbw-rgb-grad)" stroke-width="10" stroke-linecap="round" />
                        <circle :cx="arcPointerX" :cy="arcPointerY" r="8" :fill="hexColor" stroke="#fff" stroke-width="2" :filter="`drop-shadow(0 0 6px ${hexColor}80)`" />
                    </svg>
                    <!-- CCT warm-cool arc -->
                    <svg v-else viewBox="0 0 200 110" fill="none">
                        <defs>
                            <linearGradient id="rgbw-cct-grad" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stop-color="#FF9329" />
                                <stop offset="50%" stop-color="#FFF4E0" />
                                <stop offset="100%" stop-color="#B4D4FF" />
                            </linearGradient>
                        </defs>
                        <path d="M20,100 A80,80 0 0,1 180,100" stroke="url(#rgbw-cct-grad)" stroke-width="10" stroke-linecap="round" />
                        <circle :cx="cctPointerX" :cy="cctPointerY" r="8" :fill="cctPointerColor" stroke="#fff" stroke-width="2" :filter="`drop-shadow(0 0 6px ${cctPointerColor}80)`" />
                    </svg>
                </div>
                <div class="ec-cct-val">
                    <div class="ec-cct-pct">{{ brightnessDisplay }}<span>%</span></div>
                </div>
            </div>

            <!-- Brightness slider -->
            <div class="ec-clr-sliders">
                <div class="ec-clr-srow">
                    <div class="ec-clr-track">
                        <input
                            type="range"
                            class="sld-r sld-bri"
                            min="0" max="100"
                            :value="brightness"
                            :disabled="!canExecute"
                            @change="onBriSliderChange"
                            @click.stop
                        />
                    </div>
                </div>
            </div>

            <!-- Color presets (RGB mode) -->
            <div v-if="!isCCT" class="ec-clr-presets">
                <div
                    v-for="color in colorPresets"
                    :key="color.hex"
                    class="ec-clr-dot"
                    :class="{active: hexColor === color.hex}"
                    :style="{background: color.hex, border: color.hex === '#FFFFFF' ? '1px solid var(--color-border-default)' : undefined}"
                    @click.stop="setColor({r: color.r, g: color.g, b: color.b})"
                />
            </div>

            <!-- CCT presets (CCT mode) -->
            <div v-else class="ec-cct-presets">
                <button
                    v-for="preset in cctPresets"
                    :key="preset.kelvin"
                    class="ec-cct-pre"
                    :class="{'ec-cct-pre--active': isNearCCT(preset.kelvin)}"
                    :style="{'--cct-c': preset.color}"
                    :disabled="!canExecute"
                    @click.stop="setCCT(preset.kelvin)"
                >{{ preset.label }}</button>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
        <template #toggle>
            <CardToggle :is-on="isOn" :disabled="!canExecute" @toggle="toggle" />
        </template>
        <template #footer>
            <div class="ec-hero-info">
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ isCCT ? ctDisplay + 'K' : hexColor }}</div>
                    <div class="ec-hero-stat-l">{{ isCCT ? 'CCT' : 'Color' }}</div>
                </div>
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ powerDisplay }} {{ powerUnit }}</div>
                    <div class="ec-hero-stat-l">Power</div>
                </div>
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ tempDisplay }}</div>
                    <div class="ec-hero-stat-l">Temp</div>
                </div>
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ energyDisplay }} kWh</div>
                    <div class="ec-hero-stat-l">Today</div>
                </div>
            </div>
        </template>
    </CardShell>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {useCardRpc} from '@/composables/useCardRpc';
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
}>();

const deviceStore = useDevicesStore();
const rpc = useCardRpc();
const authStore = useAuthStore();

const device = computed(() => deviceStore.devices[props.entity.source]);
const isOffline = computed(() => !device.value?.online);
const isSleeping = computed(() => !!device.value?.sleeping);
const canExecute = computed(() =>
    authStore.canExecuteDevice(props.entity.source)
);

const status = computed(() => {
    if (!device.value) return null;
    const e = props.entity;
    return (
        deviceStore.statusOf(e.source, `${e.type}:${e.properties.id}`) ?? null
    );
});

const config = computed(() => {
    if (!device.value) return null;
    const e = props.entity;
    return device.value.settings?.[`${e.type}:${e.properties.id}`] ?? null;
});

// CT range from device config — falls back to standard range
const ctMin = computed(() => (config.value as any)?.ct_range?.[0] ?? 2700);
const ctMax = computed(() => {
    const max = (config.value as any)?.ct_range?.[1] ?? 6500;
    return max > ctMin.value ? max : ctMin.value + 1; // prevent division by zero
});

const isOn = computed(() => !!status.value?.output);
const brightness = computed(() => status.value?.brightness ?? 0);
const hasPM = computed(() => status.value?.apower !== undefined);

// Bulb = rgbcct dual-mode (Shelly Duo RGBW)
const isBulb = computed(() => props.entity.type === 'rgbcct');
const cardType = computed(() => (isBulb.value ? 'bulb' : 'rgbw'));
const cardIcon = computed(() =>
    isBulb.value ? 'fas fa-lightbulb' : 'fas fa-palette'
);

const isCCT = computed(() => {
    const mode = status.value?.mode;
    if (mode === 'cct' || mode === 'white') return true;
    return props.entity.type === 'cct';
});

/** Validate that a value is a finite number in [0, 255] */
function isValidRgb(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 255;
}

// --rgb-c inline style for dynamic color tinting
const rgbcStyle = computed(() => {
    const rgb = status.value?.rgb;
    if (isCCT.value) return {'--rgb-c': '255,208,138'};
    if (
        rgb &&
        Array.isArray(rgb) &&
        rgb.length >= 3 &&
        isValidRgb(rgb[0]) &&
        isValidRgb(rgb[1]) &&
        isValidRgb(rgb[2])
    ) {
        return {
            '--rgb-c': `${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])}`
        };
    }
    return {'--rgb-c': '255,208,138'};
});

const brightnessDisplay = computed(() => String(brightness.value));

const hexColor = computed(() => {
    const rgb = status.value?.rgb;
    if (!rgb || !Array.isArray(rgb) || rgb.length < 3) return '#FFFFFF';
    if (!isValidRgb(rgb[0]) || !isValidRgb(rgb[1]) || !isValidRgb(rgb[2]))
        return '#FFFFFF';
    return `#${rgb
        .slice(0, 3)
        .map((c: number) => Math.round(c).toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()}`;
});

const ctDisplay = computed(() => {
    const ct = status.value?.ct;
    return ct != null ? String(ct) : '—';
});

const powerDisplay = computed(() => {
    const w = status.value?.apower;
    if (w == null) return '—';
    return w >= 1000 ? (w / 1000).toFixed(1) : String(Math.round(w));
});
const powerUnit = computed(() => {
    const w = status.value?.apower;
    return w != null && w >= 1000 ? 'kW' : 'W';
});

const tempDisplay = computed(() => {
    const t = status.value?.temperature?.tC;
    return t != null ? `${t.toFixed(1)}°C` : '—';
});

const energyDisplay = computed(() => {
    const total = status.value?.aenergy?.total;
    if (total == null) return '—';
    return (total / 1000).toFixed(1);
});

// CCT slider: maps ct range to 0-100
const cctSliderValue = computed(() => {
    const ct = status.value?.ct;
    if (ct == null) return 35;
    return Math.round(((ct - ctMin.value) / (ctMax.value - ctMin.value)) * 100);
});

// Arc pointer positions (SVG coordinates on the semicircular arc)
function arcPosition(fraction: number): {x: number; y: number} {
    const angle = Math.PI * (1 - fraction);
    return {
        x: 100 + 80 * Math.cos(angle),
        y: 100 - 80 * Math.sin(angle)
    };
}

// RGB arc pointer — position based on hue
const arcPointerX = computed(() => {
    const hue = status.value?.hue ?? 0;
    return arcPosition(hue / 360).x;
});
const arcPointerY = computed(() => {
    const hue = status.value?.hue ?? 0;
    return arcPosition(hue / 360).y;
});

// CCT arc pointer — position based on color temperature
const cctPointerX = computed(() => {
    const ct = status.value?.ct ?? ctMin.value;
    const frac = (ct - ctMin.value) / (ctMax.value - ctMin.value);
    return arcPosition(frac).x;
});
const cctPointerY = computed(() => {
    const ct = status.value?.ct ?? ctMin.value;
    const frac = (ct - ctMin.value) / (ctMax.value - ctMin.value);
    return arcPosition(frac).y;
});
const cctPointerColor = computed(() => {
    const ct = status.value?.ct ?? ctMin.value;
    const frac = (ct - ctMin.value) / (ctMax.value - ctMin.value);
    if (frac < 0.5) {
        const t = frac * 2;
        return `rgb(${255}, ${Math.round(147 + (244 - 147) * t)}, ${Math.round(41 + (224 - 41) * t)})`;
    }
    const t = (frac - 0.5) * 2;
    return `rgb(${Math.round(255 - (255 - 180) * t)}, ${Math.round(244 - (244 - 212) * t)}, ${Math.round(224 + (255 - 224) * t)})`;
});

// Color presets for RGB mode
const colorPresets = [
    {hex: '#FF0000', r: 255, g: 0, b: 0},
    {hex: '#FF8800', r: 255, g: 136, b: 0},
    {hex: '#FFFF00', r: 255, g: 255, b: 0},
    {hex: '#00FF00', r: 0, g: 255, b: 0},
    {hex: '#00BFFF', r: 0, g: 191, b: 255},
    {hex: '#0000FF', r: 0, g: 0, b: 255},
    {hex: '#FF00FF', r: 255, g: 0, b: 255},
    {hex: '#FFFFFF', r: 255, g: 255, b: 255}
];

// CCT presets — generated from device range: min, preferred midpoints, max
const CCT_COLORS: Record<number, string> = {
    2200: '#FF8A14',
    2700: '#FF9329',
    3000: '#FFD08A',
    3500: '#FFE8C0',
    4000: '#FFF4E0',
    4500: '#F5F0FF',
    5000: '#E8EEFF',
    5500: '#D4E4FF',
    6000: '#C4D8FF',
    6500: '#B4D4FF',
    7000: '#A8CCFF'
};
function cctColor(k: number): string {
    const keys = Object.keys(CCT_COLORS)
        .map(Number)
        .sort((a, b) => a - b);
    const closest = keys.reduce((prev, cur) =>
        Math.abs(cur - k) < Math.abs(prev - k) ? cur : prev
    );
    return CCT_COLORS[closest] ?? '#FFD08A';
}
const cctPresets = computed(() => {
    const lo = ctMin.value;
    const hi = ctMax.value;
    const preferred = [3000, 4000].filter((k) => k > lo && k < hi);
    const mid = lo + Math.round((hi - lo) / 2);
    // If no preferred values fit, use the midpoint
    const mids = preferred.length ? preferred : [mid];
    const all = [lo, ...mids, hi];
    // Deduplicate and sort
    const unique = [...new Set(all)].sort((a, b) => a - b);
    return unique.map((k) => ({kelvin: k, label: `${k}K`, color: cctColor(k)}));
});

function isNearCCT(kelvin: number): boolean {
    const ct = status.value?.ct;
    if (ct == null) return false;
    return Math.abs(ct - kelvin) <= 200;
}

function toggle() {
    rpc.invokeAction(props.entity.id, 'toggle');
}

function setBrightness(value: number) {
    rpc.invokeAction(props.entity.id, 'setBrightness', {brightness: value});
}

function setColor(rgb: {r: number; g: number; b: number}) {
    if (!canExecute.value) return;
    rpc.invokeAction(props.entity.id, 'setColor', {rgb: [rgb.r, rgb.g, rgb.b]});
}

function setCCT(kelvin: number) {
    if (!canExecute.value) return;
    rpc.invokeAction(props.entity.id, 'setColorTemperature', {ct: kelvin});
}

function setMode(mode: 'rgb' | 'cct') {
    if (!canExecute.value) return;
    rpc.invokeAction(props.entity.id, 'setMode', {mode});
}

function onBriSliderChange(e: Event) {
    const target = e.target as HTMLInputElement;
    setBrightness(Number(target.value));
}

function onCctSliderChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const pct = Number(target.value);
    const kelvin = Math.round(
        ctMin.value + (pct / 100) * (ctMax.value - ctMin.value)
    );
    setCCT(kelvin);
}
</script>

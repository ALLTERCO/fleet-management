<template>
    <!-- 1×1: brightness % + toggle -->
    <CardShell
        v-if="size === '1x1'"
        type="dimmer"
        :name="entity.name"
        icon="fas fa-lightbulb"
        size="1x1"
        :is-on="isOn"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <button
                v-if="needsCalibration"
                class="dh-cal-btn dh-cal-btn--sm"
                :disabled="!isOperable"
                @click.stop="calibrate"
            >Calibrate</button>
            <template v-else>
                <div role="status" class="ec-dpct">{{ brightnessDisplay }}<span>%</span></div>
                <div v-if="powerMetric.value !== '—'" class="ec-sub ec-sub--sensor">{{ powerMetric.value }} {{ powerMetric.unit }}</div>
            </template>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
        <template #toggle>
            <CardToggle :is-on="isOn" :disabled="!isOperable" @toggle="toggle" />
        </template>
    </CardShell>

    <!-- 2×1: wide — left brightness + right slider + toggle -->
    <CardShell
        v-else-if="size === '2x1'"
        type="dimmer"
        :name="entity.name"
        icon="fas fa-lightbulb"
        size="2x1"
        :is-on="isOn"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="ec-wide-row">
                <div class="ec-wl">
                    <div role="status" class="ec-dpct ec-dpct--flush">{{ brightnessDisplay }}<span>%</span></div>
                    <div v-if="powerMetric.value !== '—'" class="ec-sub--power">{{ powerMetric.value }} {{ powerMetric.unit }}</div>
                </div>
                <div class="ec-wr">
                    <button
                        v-if="needsCalibration"
                        class="dh-cal-btn dh-cal-btn--sm"
                        :disabled="!isOperable"
                        @click.stop="calibrate"
                    >Calibrate</button>
                    <span v-else-if="isCalibrating" class="dh-cal-progress">{{ calibrationProgress }}%</span>
                    <div v-else class="ec-clr-track">
                        <input
                            type="range"
                            class="sld-r sld-bri"
                            min="0"
                            max="100"
                            :value="displayBrightness"
                            :disabled="controlsDisabled || isOffline"
                            @input="onSliderInput"
                            @change="onSliderChange"
                            @click.stop
                        />
                    </div>
                    <CardToggle :is-on="isOn" :disabled="!isOperable" @toggle="toggle" />
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2×2: hero — brightness matrix + slider + presets + stats -->
    <CardShell
        v-else
        type="dimmer"
        :name="entity.name"
        icon="fas fa-lightbulb"
        size="2x2"
        :is-on="isOn"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <!-- Top: filament visual + big percentage -->
            <div class="dh-top">
                <div class="ec-filament" :data-val="brightness" :style="filamentVars">
                    <svg aria-hidden="true" viewBox="0 0 80 130" width="100" height="150">
                        <line class="ec-fil-support" x1="33" y1="120" x2="33" y2="82"/>
                        <line class="ec-fil-support" x1="47" y1="120" x2="47" y2="82"/>
                        <path class="ec-fil-wire" d="M33 82 L37 75 L43 82 L47 75 L43 68 L37 75 L33 68 L37 61 L43 68 L47 61 L43 54 L37 61 L33 54 L37 47 L43 54 L47 47 L43 40 L37 47 L33 40 L37 33 L43 40 L47 33 L43 26 L37 33 L33 26 L37 19 L43 26 L47 19" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <div class="ec-fil-glare"></div>
                </div>
                <div class="dh-value">
                    <div class="dh-pct">{{ brightnessDisplay }}<span>%</span></div>
                </div>
            </div>

            <!-- Controls: slider, presets, toggle -->
            <div class="dh-controls">
                <div class="dh-slider">
                    <div class="ec-clr-track">
                        <input
                            type="range"
                            class="sld-r sld-bri"
                            min="0"
                            max="100"
                            :value="displayBrightness"
                            :disabled="controlsDisabled || isOffline"
                            @input="onSliderInput"
                            @change="onSliderChange"
                            @click.stop
                        />
                    </div>
                </div>
                <div v-if="needsCalibration || isCalibrating" class="dh-calibrate">
                    <button
                        v-if="!isCalibrating"
                        class="dh-cal-btn"
                        :disabled="!isOperable"
                        @click.stop="calibrate"
                    >Calibrate dimmer</button>
                    <span v-else class="dh-cal-progress">Calibrating… {{ calibrationProgress }}%</span>
                </div>
                <div v-else class="dh-presets">
                    <button
                        v-for="p in presets"
                        :key="p"
                        class="dh-qp"
                        :class="{act: isNearPreset(p)}"
                        :disabled="controlsDisabled || isOffline"
                        :aria-label="`Set brightness to ${p}%`"
                        @click.stop="setBrightness(p)"
                    >{{ p }}%</button>
                </div>
                <div class="dh-toggle">
                    <CardToggle :is-on="isOn" :disabled="!isOperable" @toggle="toggle" />
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
        <template #footer>
            <!-- PM stats — value + unit only, no labels -->
            <div v-if="hasPM" class="ec-hero-info ec-hero-info--values">
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ powerMetric.value }} {{ powerMetric.unit }}</div>
                </div>
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ currentMetric.value }} {{ currentMetric.unit }}</div>
                </div>
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ voltageMetric.value }} {{ voltageMetric.unit }}</div>
                </div>
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ tempMetric.value }}{{ tempMetric.unit }}</div>
                </div>
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ todayMetric.value }} {{ todayMetric.unit }}</div>
                </div>
            </div>
            <!-- No-PM: no footer stats (matches mockup) -->
        </template>
    </CardShell>
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from 'vue';
import {useCardRpc} from '@/composables/useCardRpc';
import {useLightCalibration} from '@/composables/useLightCalibration';
import {useOptimisticSlider} from '@/composables/useOptimisticSlider';
import {
    formatCurrent,
    formatEnergy,
    formatPower,
    formatTemperature,
    formatVoltage
} from '@/helpers/powerMetrics';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import {loadDailyEnergy} from '@/tools/dailyEnergyLoader';
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
const authStore = useAuthStore();
const rpc = useCardRpc();

const device = computed(() => deviceStore.devices[props.entity.source]);
const isOffline = computed(() => !device.value?.online);
const isSleeping = computed(() => !!device.value?.sleeping);
const canExecute = computed(() =>
    authStore.canExecuteDevice(props.entity.source)
);
// A command only lands if we're allowed AND the device is reachable — gate the
// controls on this so an offline light shows disabled controls, not dead taps.
const isOperable = computed(() => canExecute.value && !isOffline.value);

const status = computed(() => {
    if (!device.value) return null;
    const e = props.entity;
    return (
        deviceStore.statusOf(e.source, `${e.type}:${e.properties.id}`) ?? null
    );
});

const isOn = computed(() => !!status.value?.output);
const brightness = computed(() => status.value?.brightness ?? 0);
const hasPM = computed(() => status.value?.apower !== undefined);
const presets = [25, 50, 75, 100];

// Slider follows the finger while dragging, the device when idle (shared).
const {
    display: displayBrightness,
    onInput: onSliderInput,
    onChange: onSliderChange
} = useOptimisticSlider(brightness, setBrightness);

// Calibration lock (shared with the RGBW/CCT card).
const {needsCalibration, isCalibrating, calibrationProgress, controlsDisabled} =
    useLightCalibration(status, canExecute);

function calibrate() {
    rpc.invokeAction(props.entity.id, 'calibrate', {}, 'Calibrate');
}

const brightnessDisplay = computed(() => String(displayBrightness.value));

const filamentVars = computed(() => {
    const norm = isOn.value ? displayBrightness.value / 100 : 0;
    return {
        '--glare-o': norm,
        '--fil-stroke': `rgba(var(--accent-dimmer), ${0.25 + norm * 0.75})`,
        '--fil-drop': `drop-shadow(0 0 ${3 + norm * 12}px rgba(var(--accent-dimmer), ${0.1 + norm * 0.6}))`
    } as Record<string, string | number>;
});

// All readouts go through the shared display standard (powerMetrics.ts).
const powerMetric = computed(() => formatPower(status.value?.apower));
const currentMetric = computed(() => formatCurrent(status.value?.current));
const voltageMetric = computed(() => formatVoltage(status.value?.voltage));
const tempMetric = computed(() =>
    formatTemperature(status.value?.temperature?.tC)
);

// "Today" is real daily usage from the 1-day rollup, not the lifetime
// aenergy.total counter. Same batched loader the switch card uses.
const dailyEnergy = ref<{today: number; yesterday: number} | null>(null);
onMounted(async () => {
    if (!hasPM.value || props.size !== '2x2') return;
    try {
        dailyEnergy.value = await loadDailyEnergy(props.entity.source);
    } catch {
        /* device may have no energy history yet */
    }
});
const todayMetric = computed(() =>
    formatEnergy(dailyEnergy.value ? dailyEnergy.value.today * 1000 : null)
);

function isNearPreset(preset: number): boolean {
    return Math.abs(displayBrightness.value - preset) <= 3;
}

function toggle() {
    rpc.invokeAction(props.entity.id, 'setOutput', {on: !isOn.value});
}

function setBrightness(value: number) {
    rpc.invokeAction(
        props.entity.id,
        'setBrightness',
        {brightness: value},
        'Brightness'
    );
}
</script>

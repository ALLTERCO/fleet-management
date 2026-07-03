<template>
    <div class="led-config">
        <!-- LED Mode -->
        <div class="led-config__row">
            <span class="led-config__label">LED Mode</span>
            <Dropdown
                :default="localMode"
                :options="['power', 'switch', 'off']"
                :disabled="!canExecute"
                @selected="(val) => setConfig({leds: {mode: val}})"
            />
        </div>

        <!-- Power mode brightness -->
        <div v-if="localMode === 'power'" class="led-config__row">
            <span class="led-config__label">Power Brightness</span>
            <div class="led-config__slider-row">
                <input
                    type="range" class="led-config__slider" min="0" max="100"
                    :value="powerBrightness" :disabled="!canExecute"
                    @change="(e) => setConfig({leds: {colors: {power: {brightness: Number((e.target as HTMLInputElement).value)}}}})"
                />
                <span class="led-config__val">{{ powerBrightness }}%</span>
            </div>
        </div>

        <!-- Switch mode colors -->
        <template v-if="localMode === 'switch'">
            <div v-for="(colorCfg, switchKey) in switchColors" :key="switchKey" class="led-config__color-section">
                <div class="led-config__section-title">{{ switchKey }}</div>

                <!-- ON color -->
                <div class="led-config__color-row">
                    <span class="led-config__label">ON</span>
                    <div class="led-config__color-controls">
                        <div class="led-config__swatch" :style="{background: toCSS(colorCfg.on?.rgb)}" @click="editingColor = {switchKey, state: 'on', rgb: [...(colorCfg.on?.rgb ?? [0,100,0])]}" />
                        <input
                            type="range" class="led-config__slider" min="0" max="100"
                            :value="colorCfg.on?.brightness ?? 100" :disabled="!canExecute"
                            @change="(e) => setConfig({leds: {colors: {[switchKey]: {on: {brightness: Number((e.target as HTMLInputElement).value)}}}}})"
                        />
                        <span class="led-config__val">{{ colorCfg.on?.brightness ?? 100 }}%</span>
                    </div>
                </div>

                <!-- OFF color (not on PLUGPM) -->
                <div v-if="colorCfg.off" class="led-config__color-row">
                    <span class="led-config__label">OFF</span>
                    <div class="led-config__color-controls">
                        <div class="led-config__swatch" :style="{background: toCSS(colorCfg.off?.rgb)}" @click="editingColor = {switchKey, state: 'off', rgb: [...(colorCfg.off?.rgb ?? [100,0,0])]}" />
                        <input
                            type="range" class="led-config__slider" min="0" max="100"
                            :value="colorCfg.off?.brightness ?? 100" :disabled="!canExecute"
                            @change="(e) => setConfig({leds: {colors: {[switchKey]: {off: {brightness: Number((e.target as HTMLInputElement).value)}}}}})"
                        />
                        <span class="led-config__val">{{ colorCfg.off?.brightness ?? 100 }}%</span>
                    </div>
                </div>
            </div>
        </template>

        <!-- Color picker overlay -->
        <div v-if="editingColor && canExecute" class="led-config__picker">
            <ColorWheel :rgb="toWheel(editingColor.rgb)" @change="onColorPick" />
            <div class="led-config__picker-actions">
                <Button type="blue" size="sm" @click="applyColor">Apply</Button>
                <Button type="blue-hollow" size="sm" @click="editingColor = null">Cancel</Button>
            </div>
        </div>

        <!-- Night Mode -->
        <div class="led-config__section-title">Night Mode</div>
        <div class="led-config__row">
            <span class="led-config__label">Enable</span>
            <Checkbox
                :model-value="nightMode.enable"
                :disabled="!canExecute"
                @update:model-value="(val) => setConfig({leds: {night_mode: {enable: val}}})"
            />
        </div>

        <template v-if="nightMode.enable">
            <div class="led-config__row">
                <span class="led-config__label">Brightness</span>
                <div class="led-config__slider-row">
                    <input
                        type="range" class="led-config__slider" min="0" max="100"
                        :value="nightMode.brightness ?? 10" :disabled="!canExecute"
                        @change="(e) => setConfig({leds: {night_mode: {brightness: Number((e.target as HTMLInputElement).value)}}})"
                    />
                    <span class="led-config__val">{{ nightMode.brightness ?? 10 }}%</span>
                </div>
            </div>

            <div class="led-config__row">
                <span class="led-config__label">Active</span>
                <div class="led-config__time-row">
                    <input type="time" class="led-config__time" :value="nightMode.active_between?.[0] ?? '22:00'" :disabled="!canExecute"
                        @change="(e) => setNightSchedule(0, (e.target as HTMLInputElement).value)" />
                    <span class="led-config__val">to</span>
                    <input type="time" class="led-config__time" :value="nightMode.active_between?.[1] ?? '06:00'" :disabled="!canExecute"
                        @change="(e) => setNightSchedule(1, (e.target as HTMLInputElement).value)" />
                </div>
            </div>
        </template>

        <!-- Button Controls -->
        <template v-if="Object.keys(controls).length > 0">
            <div class="led-config__section-title">Button Controls</div>
            <div v-for="(ctrl, key) in controls" :key="key" class="led-config__row">
                <span class="led-config__label">{{ key }}</span>
                <Dropdown
                    :default="ctrl.in_mode"
                    :options="['momentary', 'detached']"
                    :disabled="!canExecute"
                    @selected="(val) => setConfig({controls: {[key]: {in_mode: val}}})"
                />
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import Button from './Button.vue';
import Checkbox from './Checkbox.vue';
import ColorWheel from './ColorWheel.vue';
import Dropdown from './Dropdown.vue';

const props = defineProps<{
    shellyID: string;
    canExecute: boolean;
}>();

const deviceStore = useDevicesStore();
const toast = useToastStore();

// Detect which UI namespace this device uses
const UI_KEYS = [
    'powerstrip_ui',
    'plugs_ui',
    'pluguk_ui',
    'plugpm_ui'
] as const;

const uiKey = computed(() => {
    const settings = deviceStore.devices[props.shellyID]?.settings;
    if (!settings) return null;
    for (const k of UI_KEYS) {
        if (k in settings) return k;
    }
    return null;
});

const rpcNamespace = computed(() => {
    const map: Record<string, string> = {
        powerstrip_ui: 'POWERSTRIP_UI',
        plugs_ui: 'PLUGS_UI',
        pluguk_ui: 'PLUGUK_UI',
        plugpm_ui: 'PLUGPM_UI'
    };
    return uiKey.value ? (map[uiKey.value] ?? null) : null;
});

const config = computed(() => {
    if (!uiKey.value) return null;
    return deviceStore.devices[props.shellyID]?.settings?.[uiKey.value] ?? null;
});

const localMode = computed(() => config.value?.leds?.mode ?? 'power');
const powerBrightness = computed(
    () => config.value?.leds?.colors?.power?.brightness ?? 100
);
const nightMode = computed(
    () => config.value?.leds?.night_mode ?? {enable: false}
);
const controls = computed(() => config.value?.controls ?? {});

const switchColors = computed(() => {
    const colors = config.value?.leds?.colors ?? {};
    const result: Record<string, any> = {};
    for (const [key, val] of Object.entries(colors)) {
        if (key !== 'power') result[key] = val;
    }
    return result;
});

// RGB 0-100 (Shelly) ↔ 0-255 (ColorWheel)
function toCSS(rgb: number[] | undefined): string {
    if (!rgb || rgb.length < 3) return 'transparent';
    return `rgb(${Math.round(rgb[0] * 2.55)}, ${Math.round(rgb[1] * 2.55)}, ${Math.round(rgb[2] * 2.55)})`;
}

function toWheel(rgb100: number[]): [number, number, number] {
    return [
        Math.round(rgb100[0] * 2.55),
        Math.round(rgb100[1] * 2.55),
        Math.round(rgb100[2] * 2.55)
    ];
}

function fromWheel(rgb255: [number, number, number]): number[] {
    return [
        Math.round(rgb255[0] / 2.55),
        Math.round(rgb255[1] / 2.55),
        Math.round(rgb255[2] / 2.55)
    ];
}

// Color picker state
const editingColor = ref<{
    switchKey: string;
    state: 'on' | 'off';
    rgb: number[];
} | null>(null);

function onColorPick(rgb255: [number, number, number]) {
    if (editingColor.value) {
        editingColor.value.rgb = fromWheel(rgb255);
    }
}

function applyColor() {
    if (!editingColor.value) return;
    const {switchKey, state, rgb} = editingColor.value;
    setConfig({leds: {colors: {[switchKey]: {[state]: {rgb}}}}});
    editingColor.value = null;
}

async function setConfig(update: Record<string, any>) {
    if (!rpcNamespace.value) return;
    try {
        await sendRPC('FLEET_MANAGER', 'Ui.Plug.SetConfig', {
            shellyID: props.shellyID,
            component: rpcNamespace.value,
            config: update
        });
    } catch (err: any) {
        toast.error(err?.message ?? 'Failed to update');
    }
}

function setNightSchedule(index: number, value: string) {
    const current = [...(nightMode.value.active_between ?? ['22:00', '06:00'])];
    current[index] = value;
    setConfig({leds: {night_mode: {active_between: current}}});
}
</script>

<style scoped>
.led-config {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.led-config__section-title {
    font-size: var(--type-body);
    font-weight: var(--font-black);
    color: var(--color-text-disabled);
    text-transform: none;
    letter-spacing: normal;
    padding-top: var(--space-1);
}
.led-config__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-1) 0;
}
.led-config__label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    flex-shrink: 0;
}
.led-config__val {
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    flex-shrink: 0;
    min-width: 36px;
    text-align: right;
}
.led-config__slider-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.led-config__slider {
    width: 120px;
    accent-color: var(--color-primary);
}
.led-config__color-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.led-config__color-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
}
.led-config__color-controls {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    justify-content: flex-end;
}
.led-config__swatch {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-md);
    border: 2px solid var(--color-border-default);
    cursor: pointer;
    flex-shrink: 0;
    transition: border-color var(--duration-fast);
}
.led-config__swatch:hover {
    border-color: var(--color-primary);
}
.led-config__picker {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
}
.led-config__picker-actions {
    display: flex;
    gap: var(--space-2);
}
.led-config__time-row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
}
.led-config__time {
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-family: inherit;
    outline: none;
}
.led-config__time:focus {
    border-color: var(--color-primary);
}
</style>

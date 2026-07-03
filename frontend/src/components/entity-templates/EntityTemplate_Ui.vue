<template>
    <div class="et-ui">
        <!-- Brightness -->
        <div v-if="hasBrightness" class="et-ui__section">
            <div class="et-ui__row">
                <i class="fas fa-sun et-ui__icon" />
                <span class="et-ui__label">Brightness</span>
                <span class="et-ui__value">{{ brightnessLevel }}</span>
                <button v-if="canExecute" class="et-ui__toggle" :class="isAutoBrightness && 'et-ui__toggle--on'" @click="setConfig({brightness: {auto: !isAutoBrightness}})">
                    {{ isAutoBrightness ? 'Auto' : 'Manual' }}
                </button>
            </div>
            <HorizontalSlider
                v-if="canExecute"
                :value="brightnessLevel"
                :min="0" :max="255" :step="1"
                @change="(v: number) => setConfig({brightness: {level: v}})"
            >
                <template #title>{{ brightnessLevel }} / 255</template>
            </HorizontalSlider>
        </div>

        <!-- Auto Dim -->
        <div v-if="canExecute && hasBrightness" class="et-ui__row">
            <i class="fas fa-moon et-ui__icon--dim" />
            <span class="et-ui__label">Auto Dim</span>
            <button class="et-ui__toggle" :class="autoDim.enable && 'et-ui__toggle--on'" @click="setConfig({brightness: {auto_dim: {enable: !autoDim.enable}}})">
                {{ autoDim.enable ? 'ON' : 'OFF' }}
            </button>
        </div>
        <div v-if="canExecute && autoDim.enable" class="et-ui__indent">
            <HorizontalSlider :value="autoDim.timeout" :min="5" :max="300" @change="(v: number) => setConfig({brightness: {auto_dim: {timeout: v}}})">
                <template #title>Timeout {{ autoDim.timeout }}s</template>
            </HorizontalSlider>
        </div>

        <!-- Auto Off -->
        <div v-if="canExecute && hasBrightness" class="et-ui__row">
            <i class="fas fa-power-off et-ui__icon--dim" />
            <span class="et-ui__label">Auto Off</span>
            <button class="et-ui__toggle" :class="autoOff.enable && 'et-ui__toggle--on'" @click="setConfig({brightness: {auto_off: {enable: !autoOff.enable}}})">
                {{ autoOff.enable ? 'ON' : 'OFF' }}
            </button>
        </div>
        <div v-if="canExecute && autoOff.enable" class="et-ui__indent">
            <HorizontalSlider :value="autoOff.timeout" :min="5" :max="600" @change="(v: number) => setConfig({brightness: {auto_off: {timeout: v}}})">
                <template #title>Timeout {{ autoOff.timeout }}s</template>
            </HorizontalSlider>
            <div class="et-ui__row">
                <span class="et-ui__label">By Lux</span>
                <button class="et-ui__toggle" :class="autoOff.by_lux && 'et-ui__toggle--on'" @click="setConfig({brightness: {auto_off: {by_lux: !autoOff.by_lux}}})">
                    {{ autoOff.by_lux ? 'ON' : 'OFF' }}
                </button>
            </div>
        </div>

        <!-- Temperature Unit -->
        <div v-if="canExecute" class="et-ui__row">
            <i class="fas fa-temperature-half et-ui__icon--dim" />
            <span class="et-ui__label">Temperature Unit</span>
            <button class="et-ui__toggle" :class="useF && 'et-ui__toggle--on'" @click="setConfig({use_F: !useF})">
                {{ useF ? '°F' : '°C' }}
            </button>
        </div>

        <!-- Screen Lock -->
        <div v-if="canExecute" class="et-ui__row">
            <i class="fas fa-lock et-ui__icon--dim" />
            <span class="et-ui__label">Lock</span>
            <select class="et-ui__select" :value="lockType" @change="(e: Event) => setConfig({lock_type: (e.target as HTMLSelectElement).value})">
                <option value="none">None</option>
                <option value="sett">Settings Only</option>
                <option value="full">Full</option>
            </select>
        </div>

        <!-- Disable Gestures When Locked -->
        <div v-if="canExecute && lockType !== 'none'" class="et-ui__row et-ui__indent">
            <span class="et-ui__label">Disable Gestures When Locked</span>
            <button class="et-ui__toggle" :class="disableGestures && 'et-ui__toggle--on'" @click="setConfig({disable_gestures_when_locked: !disableGestures})">
                {{ disableGestures ? 'ON' : 'OFF' }}
            </button>
        </div>

        <!-- Screen Saver -->
        <div v-if="canExecute" class="et-ui__row">
            <i class="fas fa-clock et-ui__icon--dim" />
            <span class="et-ui__label">Screen Saver</span>
            <button class="et-ui__toggle" :class="screenSaver.enable && 'et-ui__toggle--on'" @click="setConfig({screen_saver: {enable: !screenSaver.enable}})">
                {{ screenSaver.enable ? 'ON' : 'OFF' }}
            </button>
        </div>
        <div v-if="canExecute && screenSaver.enable" class="et-ui__indent">
            <HorizontalSlider :value="screenSaver.timeout" :min="5" :max="300" @change="(v: number) => setConfig({screen_saver: {timeout: v}})">
                <template #title>Timeout {{ screenSaver.timeout }}s</template>
            </HorizontalSlider>
            <div class="et-ui__row">
                <span class="et-ui__label">Priority</span>
                <select class="et-ui__select" :value="screenSaver.priority_element" @change="(e: Event) => setConfig({screen_saver: {priority_element: (e.target as HTMLSelectElement).value}})">
                    <option value="CLOCK">Clock</option>
                    <option value="TEMPERATURE">Temperature</option>
                    <option value="HUMIDITY">Humidity</option>
                </select>
            </div>
        </div>

        <!-- Relay State Overlay -->
        <div v-if="canExecute && hasRelayOverlay" class="et-ui__row">
            <i class="fas fa-toggle-on et-ui__icon--dim" />
            <span class="et-ui__label">Relay Overlay</span>
            <button class="et-ui__toggle" :class="relayOverlay.enable && 'et-ui__toggle--on'" @click="setConfig({relay_state_overlay: {enable: !relayOverlay.enable}})">
                {{ relayOverlay.enable ? 'ON' : 'OFF' }}
            </button>
        </div>
        <div v-if="canExecute && relayOverlay.enable && hasRelayOverlay" class="et-ui__row et-ui__indent">
            <span class="et-ui__label">Always Visible</span>
            <button class="et-ui__toggle" :class="relayOverlay.always_visible && 'et-ui__toggle--on'" @click="setConfig({relay_state_overlay: {always_visible: !relayOverlay.always_visible}})">
                {{ relayOverlay.always_visible ? 'ON' : 'OFF' }}
            </button>
        </div>

        <!-- Remote screen control -->
        <div v-if="canExecute" class="et-ui__section">
            <div class="et-ui__row">
                <i class="fas fa-hand-pointer et-ui__icon--dim" />
                <span class="et-ui__label">Remote Control</span>
            </div>
            <div class="et-ui__remote">
                <button class="et-ui__remote-btn" aria-label="Home screen" @click="screenSet('home')"><i class="fas fa-house" /></button>
                <button class="et-ui__remote-btn" aria-label="Swipe up" @click="swipe('up')"><i class="fas fa-chevron-up" /></button>
                <button class="et-ui__remote-btn" aria-label="Media screen" @click="screenSet('media')"><i class="fas fa-music" /></button>
                <button class="et-ui__remote-btn" aria-label="Swipe left" @click="swipe('left')"><i class="fas fa-chevron-left" /></button>
                <button class="et-ui__remote-btn et-ui__remote-btn--main" aria-label="Tap" @click="tap()"><i class="fas fa-hand-pointer" /></button>
                <button class="et-ui__remote-btn" aria-label="Swipe right" @click="swipe('right')"><i class="fas fa-chevron-right" /></button>
                <button class="et-ui__remote-btn" aria-label="Thermostat screen" @click="screenSet('thermostat')"><i class="fas fa-temperature-half" /></button>
                <button class="et-ui__remote-btn" aria-label="Swipe down" @click="swipe('down')"><i class="fas fa-chevron-down" /></button>
                <button class="et-ui__remote-btn" aria-label="Settings screen" @click="screenSet('settings')"><i class="fas fa-gear" /></button>
            </div>
        </div>

        <!-- Read-only view when no execute permission -->
        <div v-if="!canExecute && configRows.length" class="et-ui__config">
            <div v-for="row in configRows" :key="row.label" class="et-ui__config-row">
                <span class="et-ui__config-label">{{ row.label }}</span>
                <span class="et-ui__config-value">{{ row.value }}</span>
            </div>
        </div>

        <div v-if="configError" class="et-ui__error">
            <i class="fas fa-triangle-exclamation" /> {{ configError }}
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import HorizontalSlider from '@/components/core/HorizontalSlider.vue';
import {sendRPC} from '@/tools/websocket';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    shellyID?: string;
}>();

const emit = defineEmits<{
    'set-screen': [screen: string];
    swipe: [direction: string];
    tap: [];
}>();

const configError = ref<string | null>(null);

async function setConfig(config: Record<string, any>) {
    if (!props.shellyID) return;
    configError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Ui.SetConfig', {
            shellyID: props.shellyID,
            config
        });
    } catch (e: any) {
        configError.value = e.message || 'Failed to update config';
    }
}

const brightnessConfig = computed(() => props.settings?.brightness);
const brightnessLevel = computed(() => brightnessConfig.value?.level ?? 50);
const isAutoBrightness = computed(() => !!brightnessConfig.value?.auto);
const hasBrightness = computed(
    () => brightnessConfig.value?.level !== undefined
);

const autoDim = computed(
    () => brightnessConfig.value?.auto_dim ?? {enable: false, timeout: 0}
);
const autoOff = computed(
    () =>
        brightnessConfig.value?.auto_off ?? {
            enable: false,
            timeout: 0,
            by_lux: false
        }
);

const useF = computed(() => !!props.settings?.use_F);
const lockType = computed(() => props.settings?.lock_type ?? 'none');
const disableGestures = computed(
    () => !!props.settings?.disable_gestures_when_locked
);

const screenSaver = computed(
    () =>
        props.settings?.screen_saver ?? {
            enable: false,
            timeout: 20,
            priority_element: 'CLOCK'
        }
);

const relayOverlay = computed(
    () =>
        props.settings?.relay_state_overlay ?? {
            enable: false,
            always_visible: false
        }
);
const hasRelayOverlay = computed(
    () => props.settings?.relay_state_overlay !== undefined
);

function screenSet(screen: string) {
    configError.value = null;
    emit('set-screen', screen);
}

function swipe(direction: string) {
    configError.value = null;
    emit('swipe', direction);
}

function tap() {
    configError.value = null;
    emit('tap');
}

const configRows = computed(() => {
    const c = props.settings;
    if (!c) return [];
    const out: {label: string; value: string}[] = [];
    const skip = new Set(['id', 'name', 'brightness']);
    for (const [k, v] of Object.entries(c)) {
        if (skip.has(k)) continue;
        if (v == null || typeof v === 'object') continue;
        out.push({
            label: k
                .replace(/_/g, ' ')
                .replace(/\b\w/g, (ch) => ch.toUpperCase()),
            value: typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)
        });
    }
    return out;
});
</script>

<style scoped>
.et-ui {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.et-ui__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.et-ui__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.et-ui__indent {
    padding-left: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
}
.et-ui__icon {
    color: var(--color-warning-text);
    font-size: var(--type-body);
    width: 18px;
    text-align: center;
}
.et-ui__icon--dim {
    color: var(--color-text-disabled);
    font-size: var(--type-body);
    width: 18px;
    text-align: center;
}
.et-ui__label {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    flex: 1;
}
.et-ui__value {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
}
.et-ui__toggle {
    padding: 0.2rem var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    color: var(--color-text-disabled);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    cursor: pointer;
    min-width: 48px;
    text-align: center;
}
.et-ui__toggle--on {
    background: var(--color-primary-subtle);
    border-color: var(--color-primary);
    color: var(--color-primary);
}
.et-ui__select {
    padding: 0.2rem 0.4rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    cursor: pointer;
}
.et-ui__config {
    border-top: 1px solid var(--color-border-default);
    padding-top: var(--space-2);
}
.et-ui__config-row {
    display: flex;
    justify-content: space-between;
    padding: var(--space-1) 0;
    font-size: var(--type-body);
}
.et-ui__config-label { color: var(--color-text-tertiary); }
.et-ui__config-value { color: var(--color-text-primary); font-weight: var(--font-medium); text-transform: capitalize; }
.et-ui__error {
    font-size: var(--type-body);
    color: var(--color-danger-text);
    display: flex;
    align-items: center;
    gap: var(--space-1);
}
/* Remote control pad */
.et-ui__remote {
    display: grid;
    grid-template-columns: repeat(3, 40px);
    gap: var(--space-1);
    justify-content: center;
}
.et-ui__remote-btn {
    width: 40px; height: 40px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
}
.et-ui__remote-btn:hover { background: var(--color-surface-3); color: var(--color-text-primary); }
.et-ui__remote-btn--main {
    background: var(--color-primary-subtle);
    border-color: var(--color-primary);
    color: var(--color-primary);
}
</style>

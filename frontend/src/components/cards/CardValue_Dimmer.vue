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
            <div role="status" class="ec-dpct">{{ brightnessDisplay }}<span>%</span></div>
            <div v-if="powerDisplay !== '—'" class="ec-sub ec-sub--sensor">{{ powerDisplay }} {{ powerUnit }}</div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
        <template #toggle>
            <CardToggle :is-on="isOn" :disabled="!canExecute" @toggle="toggle" />
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
                    <div v-if="powerDisplay !== '—'" class="ec-sub--power">{{ powerDisplay }} {{ powerUnit }}</div>
                </div>
                <div class="ec-wr">
                    <div class="ec-clr-track">
                        <input
                            type="range"
                            class="sld-r sld-bri"
                            min="0"
                            max="100"
                            :value="brightness"
                            :disabled="!canExecute"
                            @change="onSliderChange"
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
                    <div v-if="powerDisplay !== '—'" class="dh-sub">{{ powerDisplay }} {{ powerUnit }}</div>
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
                            :value="brightness"
                            :disabled="!canExecute"
                            @change="onSliderChange"
                            @click.stop
                        />
                    </div>
                </div>
                <div class="dh-presets">
                    <button
                        v-for="p in presets"
                        :key="p"
                        class="dh-qp"
                        :class="{act: isNearPreset(p)}"
                        :disabled="!canExecute"
                        :aria-label="`Set brightness to ${p}%`"
                        @click.stop="setBrightness(p)"
                    >{{ p }}%</button>
                </div>
                <div class="dh-toggle">
                    <CardToggle :is-on="isOn" :disabled="!canExecute" @toggle="toggle" />
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
        <template #footer>
            <!-- PM: power stats -->
            <div v-if="hasPM" class="ec-hero-info">
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ powerDisplay }} {{ powerUnit }}</div>
                    <div class="ec-hero-stat-l">Power</div>
                </div>
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ currentDisplay }} A</div>
                    <div class="ec-hero-stat-l">Current</div>
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
            <!-- No-PM: no footer stats (matches mockup) -->
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
const authStore = useAuthStore();
const rpc = useCardRpc();

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

const isOn = computed(() => !!status.value?.output);
const brightness = computed(() => status.value?.brightness ?? 0);
const hasPM = computed(() => status.value?.apower !== undefined);
const presets = [25, 50, 75, 100];

const brightnessDisplay = computed(() => String(brightness.value));

const filamentVars = computed(() => {
    const norm = isOn.value ? brightness.value / 100 : 0;
    return {
        '--glare-o': norm,
        '--fil-stroke': `rgba(var(--accent-dimmer), ${0.25 + norm * 0.75})`,
        '--fil-drop': `drop-shadow(0 0 ${3 + norm * 12}px rgba(var(--accent-dimmer), ${0.1 + norm * 0.6}))`
    } as Record<string, string | number>;
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

const currentDisplay = computed(() => {
    const a = status.value?.current;
    return a !== undefined && a !== null ? a.toFixed(2) : '—';
});

const tempDisplay = computed(() => {
    const t = status.value?.temperature?.tC;
    return t !== undefined && t !== null ? `${t.toFixed(1)}°C` : '—';
});

const energyDisplay = computed(() => {
    const total = status.value?.aenergy?.total;
    if (total === undefined || total === null) return '—';
    return (total / 1000).toFixed(1);
});

function isNearPreset(preset: number): boolean {
    return Math.abs(brightness.value - preset) <= 3;
}

function toggle() {
    rpc.invokeAction(props.entity.id, 'toggle');
}

function setBrightness(value: number) {
    rpc.invokeAction(props.entity.id, 'setBrightness', {brightness: value});
}

function onSliderChange(e: Event) {
    const target = e.target as HTMLInputElement;
    setBrightness(Number(target.value));
}
</script>

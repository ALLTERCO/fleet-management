<template>
    <!-- 1×1: position + 3 buttons -->
    <CardShell
        v-if="size === '1x1'"
        type="cover"
        :name="entity.name"
        icon="fas fa-arrow-up-down"
        size="1x1"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div role="status" class="ec-cpos">{{ posDisplay }}<span>%</span></div>
            <div v-if="powerDisplay !== '—'" class="ec-sub ec-sub--sensor">{{ powerDisplay }} {{ powerUnit }}</div>
            <div v-else class="ec-sub ec-sub--sensor">{{ stateText }}</div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
        <template #footer>
            <div class="ec-cbtns ec-cbtns-sm">
                <button class="ec-cbtn" :disabled="!canExecute" aria-label="Open" @click.stop="coverOpen">
                    <i class="fas fa-chevron-up" />
                </button>
                <button class="ec-cbtn" :disabled="!canExecute" aria-label="Pause" @click.stop="coverStop">
                    <i class="fas fa-pause" />
                </button>
                <button class="ec-cbtn" :disabled="!canExecute" aria-label="Close" @click.stop="coverClose">
                    <i class="fas fa-chevron-down" />
                </button>
            </div>
        </template>
    </CardShell>

    <!-- 2×1: position + slider + presets + buttons -->
    <CardShell
        v-else-if="size === '2x1'"
        type="cover"
        :name="entity.name"
        icon="fas fa-arrow-up-down"
        size="2x1"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="ec-split ec-split--40-60">
                <div class="ec-wl">
                    <div role="status" class="ec-cpos">{{ posDisplay }}<span>%</span></div>
                    <div class="ec-sub--power">{{ powerDisplay }} {{ powerUnit }}<template v-if="hasTilt"> / {{ tiltDisplay }}</template></div>
                </div>
                <div class="ec-wr">
                    <div class="ec-clr-track">
                        <input
                            type="range"
                            class="sld-r sld-cover"
                            min="0"
                            max="100"
                            :value="position"
                            :disabled="!canExecute"
                            @change="onPosSliderChange"
                            @click.stop
                        />
                    </div>
                    <div class="ec-qrow">
                        <button
                            v-for="pct in [0, 25, 50, 100]"
                            :key="pct"
                            class="ec-qp"
                            :class="{act: isNearPreset(position, pct)}"
                            :disabled="!canExecute"
                            @click.stop="coverGoTo(pct)"
                        >{{ pct }}%</button>
                    </div>
                    <div class="ec-cbtns ec-cbtns-wr">
                        <button class="ec-cbtn" :disabled="!canExecute" @click.stop="coverOpen">
                            <i class="fas fa-chevron-up" />
                        </button>
                        <button class="ec-cbtn" :disabled="!canExecute" @click.stop="coverStop">
                            <i class="fas fa-pause" />
                        </button>
                        <button class="ec-cbtn" :disabled="!canExecute" @click.stop="coverClose">
                            <i class="fas fa-chevron-down" />
                        </button>
                    </div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2×2: hero — shutter visual + sliders + presets + buttons -->
    <CardShell
        v-else
        type="cover"
        :name="entity.name"
        icon="fas fa-arrow-up-down"
        size="2x2"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        :extra-class="{'has-tilt': hasTilt}"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <!-- Shutter visual + info side by side -->
            <div class="ec-shutter-wrap">
                <div class="ec-shutter" :style="shutterVars">
                    <div class="ec-shutter-rays" />
                    <div class="ec-shutter-slats">
                        <div v-for="i in 7" :key="i" class="ec-shutter-slat" />
                    </div>
                    <div class="ec-shutter-light" />
                </div>
                <div class="ec-shutter-side">
                    <div class="ec-shutter-pct">
                        <div class="ec-shutter-pct-v">{{ posDisplay }}</div>
                        <div class="ec-shutter-pct-u">%</div>
                        <span class="ec-shutter-tilt-val ec-tilt-only">/ {{ tiltDisplay }}</span>
                    </div>
                    <div class="ec-shutter-sub">{{ powerDisplay }} {{ powerUnit }} · {{ tempDisplay }}</div>
                </div>
            </div>

            <!-- Cover controls: sliders + presets + buttons -->
            <div class="ec-cover-controls">
                <!-- Position slider -->
                <div class="ec-cover-sld ec-sld-labeled">
                    <div class="ec-sld-lbl">Position</div>
                    <div class="ec-clr-track">
                        <input
                            type="range"
                            class="sld-r sld-cover"
                            min="0"
                            max="100"
                            :value="position"
                            :disabled="!canExecute"
                            @change="onPosSliderChange"
                            @click.stop
                        />
                    </div>
                </div>
                <!-- Tilt slider (only when device supports tilt) -->
                <div v-if="hasTilt" class="ec-cover-sld ec-sld-labeled">
                    <div class="ec-sld-lbl">Tilt</div>
                    <div class="ec-clr-track">
                        <input
                            type="range"
                            class="sld-r sld-tilt"
                            min="0"
                            max="100"
                            :value="tiltAngle"
                            :disabled="!canExecute"
                            @change="onTiltSliderChange"
                            @click.stop
                        />
                    </div>
                </div>

                <!-- Presets -->
                <div class="ec-dim-presets">
                    <button
                        v-for="pct in [25, 50, 75, 100]"
                        :key="pct"
                        class="ec-qp"
                        :class="{act: isNearPreset(position, pct)}"
                        :disabled="!canExecute"
                        @click.stop="coverGoTo(pct)"
                    >{{ pct }}%</button>
                </div>

                <!-- Open / Stop / Close -->
                <div class="ec-cover-btns">
                    <button class="ec-cbtn" :disabled="!canExecute" @click.stop="coverOpen">
                        <i class="fas fa-chevron-up" /> Open
                    </button>
                    <button class="ec-cbtn" :disabled="!canExecute" @click.stop="coverStop">
                        <i class="fas fa-pause" /> Stop
                    </button>
                    <button class="ec-cbtn" :disabled="!canExecute" @click.stop="coverClose">
                        <i class="fas fa-chevron-down" /> Close
                    </button>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
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
    const key = `${e.type === 'roller' ? 'cover' : e.type}:${e.properties.id}`;
    return deviceStore.statusOf(e.source, key) ?? null;
});

const position = computed(() => status.value?.current_pos ?? 0);

const posDisplay = computed(() => {
    const pos = status.value?.current_pos;
    return pos !== undefined && pos !== null ? String(Math.round(pos)) : '—';
});

const shutterVars = computed(() => {
    const pos = position.value;
    const openPct = pos / 100;
    const tilt = tiltAngle.value;
    const tiltDeg = (tilt / 100) * 75;
    return {
        // Slats move up as cover opens (translateY negative = rolled up)
        '--slat-o': `${1 - openPct * 0.85}`,
        '--slat-tilt': `${openPct > 0.9 ? 75 : tiltDeg}deg`,
        '--slat-shift': `${-openPct * 100}%`
    };
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

const tiltAngle = computed(() => status.value?.slat_pos ?? 0);

const tiltDisplay = computed(() => {
    const t = status.value?.slat_pos;
    return t !== undefined && t !== null ? `${Math.round(t)}%` : '—';
});

const hasTilt = computed(() => {
    if (status.value?.slat_pos != null) return true;
    // Check cover config for tilt enable
    const key = `${props.entity.type === 'roller' ? 'cover' : props.entity.type}:${props.entity.properties.id}`;
    return device.value?.settings?.[key]?.slat?.enable === true;
});

const tempDisplay = computed(() => {
    const temp = status.value?.temperature?.tC;
    return temp !== undefined && temp !== null
        ? `${temp.toFixed(1)}\u00B0C`
        : '—';
});

const STATE_MAP: Record<string, string> = {
    open: 'Open',
    closed: 'Closed',
    opening: 'Opening…',
    closing: 'Closing…',
    stopped: 'Stopped',
    calibrating: 'Calibrating…'
};
const stateText = computed(() => STATE_MAP[status.value?.state] ?? 'Unknown');

function isNearPreset(current: number, preset: number): boolean {
    return Math.abs(current - preset) < 3;
}

function coverOpen() {
    rpc.invokeAction(props.entity.id, 'open');
}
function coverClose() {
    rpc.invokeAction(props.entity.id, 'close');
}
function coverStop() {
    rpc.invokeAction(props.entity.id, 'stop');
}
function coverGoTo(pos: number) {
    rpc.invokeAction(props.entity.id, 'setPosition', {pos});
}
function coverSetTilt(slat_pos: number) {
    rpc.invokeAction(props.entity.id, 'setTilt', {slat_pos});
}
function onPosSliderChange(e: Event) {
    const target = e.target as HTMLInputElement;
    coverGoTo(Number(target.value));
}
function onTiltSliderChange(e: Event) {
    const target = e.target as HTMLInputElement;
    coverSetTilt(Number(target.value));
}
</script>

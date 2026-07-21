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
            <!-- Watts to the top-right corner (only while the motor runs) so the
                 position number can own the whole tile. -->
            <div v-if="isMoving && !isOffline && powerDisplay !== '—'" class="ec-cover-watts">{{ powerDisplay }} {{ powerUnit }}</div>
            <div role="status" class="ec-cpos">{{ posDisplay }}<span>%</span></div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
        <template #footer>
            <div class="ec-cbtns ec-cbtns-sm">
                <button class="ec-cbtn" :disabled="!isOperable" aria-label="Open" @click.stop="coverOpen">
                    <i class="fas fa-chevron-up" />
                </button>
                <button class="ec-cbtn" :disabled="!isOperable" aria-label="Pause" @click.stop="coverStop">
                    <i class="fas fa-pause" />
                </button>
                <button class="ec-cbtn" :disabled="!isOperable" aria-label="Close" @click.stop="coverClose">
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
                    <div v-if="isMoving && !isOffline && powerDisplay !== '—'" class="ec-sub--power">{{ powerDisplay }} {{ powerUnit }}</div>
                    <div v-else-if="hasTilt" class="ec-sub--power">{{ tiltDisplay }}</div>
                </div>
                <div class="ec-wr">
                    <div class="ec-clr-track">
                        <input
                            type="range"
                            class="sld-r sld-cover"
                            min="0"
                            max="100"
                            :value="posSliderValue"
                            :disabled="!isOperable"
                            @input="onPosInput"
                            @change="onPosChange"
                            @click.stop
                        />
                    </div>
                    <div class="ec-qrow">
                        <button
                            v-for="pct in [0, 25, 50, 100]"
                            :key="pct"
                            class="ec-qp"
                            :class="{act: isNearPreset(position, pct)}"
                            :disabled="!isOperable"
                            @click.stop="coverGoTo(pct)"
                        >{{ pct }}%</button>
                    </div>
                    <div class="ec-cbtns ec-cbtns-wr">
                        <button class="ec-cbtn" :disabled="!isOperable" @click.stop="coverOpen">
                            <i class="fas fa-chevron-up" />
                        </button>
                        <button class="ec-cbtn" :disabled="!isOperable" @click.stop="coverStop">
                            <i class="fas fa-pause" />
                        </button>
                        <button class="ec-cbtn" :disabled="!isOperable" @click.stop="coverClose">
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
            <!-- Live power draw — only worth showing while the motor runs, so it
                 appears only when moving, as a chip in the corner clear of the
                 position/tilt inputs. -->
            <div v-if="isMoving && !isOffline && powerDisplay !== '—'" class="ec-cover-watts">
                {{ powerDisplay }} {{ powerUnit }}
            </div>

            <!-- Tall blind on the left; the position value sits beside it. The
                 blind gets shorter when a tilt row is added below, to keep
                 everything in the card. -->
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
                    </div>
                </div>
            </div>

            <!-- Cover controls: sliders + presets + buttons -->
            <div class="ec-cover-controls">
                <!-- Position slider. P/T markers show only when a Tilt row sits
                     beside it; a lone slider needs no letter. -->
                <div class="ec-cover-sld">
                    <div v-if="hasTilt" class="ec-sld-cap">P</div>
                    <div class="ec-clr-track">
                        <input
                            type="range"
                            class="sld-r sld-cover"
                            min="0"
                            max="100"
                            :value="posSliderValue"
                            :disabled="!isOperable"
                            @input="onPosInput"
                            @change="onPosChange"
                            @click.stop
                        />
                    </div>
                    <!-- Position value only when a Tilt row sits beside it (top
                         already shows position); keeps the two rows aligned. -->
                    <div v-if="hasTilt" class="ec-sld-val">{{ posDisplay }}%</div>
                </div>
                <!-- Tilt slider (only when device supports tilt) -->
                <div v-if="hasTilt" class="ec-cover-sld">
                    <div class="ec-sld-cap">T</div>
                    <div class="ec-clr-track">
                        <input
                            type="range"
                            class="sld-r sld-tilt"
                            min="0"
                            max="100"
                            :value="tiltSliderValue"
                            :disabled="!isOperable"
                            @input="onTiltInput"
                            @change="onTiltChange"
                            @click.stop
                        />
                    </div>
                    <div class="ec-sld-val">{{ tiltDisplay }}</div>
                </div>

                <!-- Presets -->
                <div class="ec-dim-presets">
                    <button
                        v-for="pct in [25, 50, 75, 100]"
                        :key="pct"
                        class="ec-qp"
                        :class="{act: isNearPreset(position, pct)}"
                        :disabled="!isOperable"
                        @click.stop="coverGoTo(pct)"
                    >{{ pct }}%</button>
                </div>

                <!-- Open / Stop / Close -->
                <div class="ec-cover-btns">
                    <button class="ec-cbtn" :disabled="!isOperable" @click.stop="coverOpen">
                        <i class="fas fa-chevron-up" /> Open
                    </button>
                    <button class="ec-cbtn" :disabled="!isOperable" @click.stop="coverStop">
                        <i class="fas fa-pause" /> Stop
                    </button>
                    <button class="ec-cbtn" :disabled="!isOperable" @click.stop="coverClose">
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
import {computed, ref, watch} from 'vue';
import {useCardRpc} from '@/composables/useCardRpc';
import {useOptimisticSlider} from '@/composables/useOptimisticSlider';
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
// A command only lands if we're allowed AND the device is reachable — gate the
// controls on this so an offline cover shows disabled controls, not dead taps.
const isOperable = computed(() => canExecute.value && !isOffline.value);

const status = computed(() => {
    if (!device.value) return null;
    const e = props.entity;
    const key = `${e.type === 'roller' ? 'cover' : e.type}:${e.properties.id}`;
    return deviceStore.statusOf(e.source, key) ?? null;
});

// Where the shutter physically is — the fallback when nothing is in flight.
const realPos = computed(() => status.value?.current_pos ?? 0);

const isMoving = computed(() => {
    const s = status.value?.state;
    return s === 'opening' || s === 'closing';
});

// Position you just commanded (slider release, preset, Open=100, Close=0). The
// blind and value show this straight away so every control drives the animation
// with no wait on the device. Stop clears it to reveal where it actually is.
const intent = ref<number | null>(null);
let sawMoving = false;

// The slider's device value: your command if one is in flight, else the target
// while it travels, else the real position.
const position = computed(() => {
    if (intent.value != null) return intent.value;
    const t = status.value?.target_pos;
    return isMoving.value && typeof t === 'number' ? t : realPos.value;
});

// Drop the command once the shutter has reached it or stopped moving, so a
// later external move isn't masked by a stale command.
watch([isMoving, realPos], ([moving]) => {
    if (intent.value == null) return;
    if (moving) {
        sawMoving = true;
        return;
    }
    if (sawMoving || Math.abs(realPos.value - intent.value) <= 1) {
        sawMoving = false;
        intent.value = null;
    }
});

const tiltAngle = computed(() => status.value?.slat_pos ?? 0);

// One display value per axis: your finger while dragging, the target/real value
// otherwise. The value and the blind animation both read these, so nothing lags
// behind the thumb — the blind tracks the slider with no hesitation.
const {
    display: posSliderValue,
    onInput: onPosInput,
    onChange: onPosChange
} = useOptimisticSlider(position, coverGoTo);

const {
    display: tiltSliderValue,
    onInput: onTiltInput,
    onChange: onTiltChange
} = useOptimisticSlider(tiltAngle, coverSetTilt);

const posDisplay = computed(() => {
    if (status.value?.current_pos == null && !isMoving.value) return '—';
    return String(Math.round(posSliderValue.value));
});

const shutterVars = computed(() => {
    const openPct = posSliderValue.value / 100;
    const tiltDeg = (tiltSliderValue.value / 100) * 75;
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

const tiltDisplay = computed(() => {
    if (status.value?.slat_pos == null) return '—';
    return `${Math.round(tiltSliderValue.value)}%`;
});

const hasTilt = computed(() => {
    if (status.value?.slat_pos != null) return true;
    // Check cover config for tilt enable
    const key = `${props.entity.type === 'roller' ? 'cover' : props.entity.type}:${props.entity.properties.id}`;
    return device.value?.settings?.[key]?.slat?.enable === true;
});


function isNearPreset(current: number, preset: number): boolean {
    return Math.abs(current - preset) < 3;
}

function coverOpen() {
    intent.value = 100;
    rpc.invokeAction(props.entity.id, 'open');
}
function coverClose() {
    intent.value = 0;
    rpc.invokeAction(props.entity.id, 'close');
}
function coverStop() {
    intent.value = null;
    rpc.invokeAction(props.entity.id, 'stop');
}
function coverGoTo(pos: number) {
    intent.value = pos;
    rpc.invokeAction(props.entity.id, 'setPosition', {pos});
}
function coverSetTilt(slat_pos: number) {
    rpc.invokeAction(props.entity.id, 'setTilt', {slat_pos});
}
</script>

<style scoped>
/* Compact shutter tiles (1×1 + 2×1): a big position number that sits dead-centre.
   The % unit is pulled out of the flow (absolute, to the number's right) and
   shrunk, so the NUMBER centres — not the number+unit pair. Scoped data-v wins
   over the shared cover rules. */
.ec[data-type='cover'].ec-wide .ec-cpos,
.ec[data-type='cover']:not(.ec-wide):not(.ec-hero) .ec-cpos {
    position: relative;
    width: auto;
    align-self: center;
    /* symmetric side padding — gives the gradient-clipped last digit room on the
       right, and balances so the NUMBER (not the box) sits centred on the middle
       button. */
    padding-left: 4px;
    padding-right: 4px;
    margin-bottom: 0;
    font-size: var(--type-display);
}
.ec[data-type='cover'].ec-wide .ec-cpos span,
.ec[data-type='cover']:not(.ec-wide):not(.ec-hero) .ec-cpos span {
    position: absolute;
    left: 100%;
    bottom: 0.12em;
    margin-left: 3px;
    font-size: var(--type-subheading);
}
/* Watts (2×1) a touch larger; shown only while moving. */
.ec[data-type='cover'].ec-wide .ec-sub--power {
    font-size: var(--type-body);
}
</style>

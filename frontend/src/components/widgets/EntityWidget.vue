<template>
    <Widget :vertical="vertical" board :selected="selected" :vc="checkIfVC(entity.type)"
        :class="[(!device || device.loading || !device.online) && '!bg-[var(--color-danger-subtle)] backdrop-blur']">

        <template #upper-corner>
            Entity
        </template>

        <template #image>
            <div class="image-container">
                <i v-lazyload class="rounded-full typeIcon" :class="getPredefinedImageForEntity(entity.type)"
                    alt="Shelly"></i>
            </div>
        </template>

        <template #name>
            <span class="text-xs text-wrap text-center truncate line-clamp-2"> {{ nameFitter }}</span>
        </template>

        <template #description>
            <span v-if="!device" class="text-[var(--color-danger-text)] font-semibold"> Error </span>
            <div v-else-if="device.loading" class="mx-auto">
                <Spinner />
            </div>
            <span v-else-if="!device.online" class="text-[var(--color-danger-text)] font-semibold"> Offline </span>
            <div v-else class="flex select-none gap-1.5 flex-col mt-1">
                <!-- Show the color of the RGBW, RGB, RGBCCT lights, and light entities with RGB support -->
                <div class="flex flex-wrap gap-1.5">
                    <span v-if="((/rgbw?|rgbcct/i.test(entity.type)) || (entity.type === 'light' && entity_status?.rgb)) && device.online && entity_status?.rgb"
                        class="entity-tag"
                        role="img" :aria-label="`Color: RGB(${entity_status.rgb.join(', ')})`">
                        <p class="border-2 rounded-full" aria-hidden="true"
                            :style="`width: 18px; height: 18px; background-color: rgb(${entity_status.rgb.join(',')});`">
                        </p>
                    </span>

                    <span v-for="[index, { icon, text }] of Object.entries(tags)" :key="index"
                        class="entity-tag">
                        <i v-if="!!icon" :class="icon" class="entity-tag__icon" /> {{ text }}
                    </span>
                </div>

                <!-- Entity controls -->
                <div v-if="entity_status && vertical" class="max-w-[80%]" @click.stop>
                    <HorizontalSlider v-if="
                        entity.type === 'number' && (entity as virtual_number_entity).properties.view === 'slider'
                    " :value="entity_status.value" :min="(entity as virtual_number_entity).properties.min"
                        :max="(entity as virtual_number_entity).properties.max"
                        :step="(entity as virtual_number_entity).properties.step"
                        :disable="waitingForResponse || !device.online || !canExecute"
                        @change="(value) => sendRpc(entity.id, 'Number.Set', { value })">
                        <template #title>
                            {{ entity_status.value }} {{ (entity as virtual_number_entity).properties.unit }}
                        </template>
                    </HorizontalSlider>

                    <HorizontalProgress v-if="
                        entity.type === 'number' &&
                        (entity as virtual_number_entity).properties.view === 'progressbar'
                    " :value="entity_status.value" :min="(entity as virtual_number_entity).properties.min"
                        :max="(entity as virtual_number_entity).properties.max"
                        :step="(entity as virtual_number_entity).properties.step" :disable="!device.online"
                        @change="(value) => sendRpc(entity.id, 'Number.Set', { value })">
                    </HorizontalProgress>

                    <form
                        v-if="entity.type === 'number' && (entity as virtual_number_entity).properties.view === 'field'"
                        class="flex flex-col items-center gap-1"
                        @submit.prevent="() => sendRpc(entity.id, 'Number.Set', { value: tempValue })">
                        <Input v-model="tempValue" :type="'number'" :placeholder="'Value'" :disabled="!canExecute" />
                        <Button submit size="xs" :disabled="!canExecute">Save</Button>
                    </form>
                    <form v-if="entity.type === 'text' && (entity as virtual_text_entity).properties.view === 'field'"
                        class="flex flex-col items-center gap-1"
                        @submit.prevent="() => sendRpc(entity.id, 'Text.Set', { value: tempValue })">
                        <Input v-model="tempValue" :type="'text'" :placeholder="'Value'"
                            :max="(entity as virtual_text_entity).properties.maxLength" :disabled="!canExecute" />
                        <Button submit size="xs" :disabled="!canExecute">Save</Button>
                    </form>
                </div>
            </div>
        </template>

        <template v-if="device" #action>
            <template v-if="editMode">
                <Button type="red" @click="emit('delete')">Delete</Button>
            </template>
            <template v-else-if="entity_status && device.online && !device.loading">
                <div v-if="entity.type === 'temperature'" class="box">
                    <p v-if="entity_status.tC !== null">{{ entity_status.tC }} °C</p>
                    <p v-else>N/A</p>
                </div>

                <div v-else-if="
                    entity.type === 'bthomesensor' &&
                    (entity as bthomesensor_entity).properties.sensorType === 'sensor' &&
                    device.online
                " class="box">
                    <p>{{ entity_status.value ?? 'N/A' }} {{ (entity as bthomesensor_entity).properties.unit }}</p>
                </div>

                <div v-else-if="
                    entity.type === 'bthomesensor' &&
                    (entity as bthomesensor_entity).properties.sensorType === 'binary_sensor' &&
                    device.online
                " class="box">
                    <p>{{ entity_status.value ? 'True' : 'False' }}</p>
                </div>

                <div v-else-if="
                    entity.type === 'bthomesensor' &&
                    (entity as bthomesensor_entity).properties?.sensorType === 'button' &&
                    device.online
                " class="box">
                    <p>{{ displayEvent }}</p>
                </div>

                <div v-else-if="entity.type === 'button' && device.online" class="box">
                    <p>{{ displayEvent }}</p>
                </div>

                <!-- Virtual Boolean component with label view -->
                <div v-else-if="
                    entity.type === 'boolean' &&
                    (entity as virtual_boolean_entity).properties.view === 'label' &&
                    device.online
                " class="box">
                    <p>
                        {{
                            entity_status.value
                                ? (entity as virtual_boolean_entity).properties.labelTrue
                                : (entity as virtual_boolean_entity).properties.labelFalse
                        }}
                    </p>
                </div>

                <!-- Virtual Boolean component with toggle control -->
                <button v-else-if="
                    entity.type === 'boolean' &&
                    (entity as virtual_boolean_entity).properties.view === 'toggle' &&
                    device.online
                " class="w-11 h-11 rounded-full flex items-center justify-center" :class="{
                        'bg-[var(--color-danger)]': !entity_status.value && canExecute,
                        'bg-[var(--color-success)]': entity_status.value && canExecute,
                        'bg-[var(--color-surface-3)] cursor-not-allowed opacity-50': !canExecute,
                    }" :disabled="!canExecute" @click.stop="() => sendRpc(entity.id, 'Boolean.Set', { value: !entity_status.value })">
                    <Spinner v-if="waitingForResponse" />
                    <template v-else>
                        <span>
                            <i class="fas fa-power-off"></i>
                        </span>
                    </template>
                </button>

                <!-- Virtual number - always show the value, except when it is hidden -->

                <div v-else-if="
                    entity.type === 'number' &&
                    (entity as virtual_number_entity).properties.view !== null &&
                    device.online
                " class="box">
                    <p>{{ entity_status.value }} {{ (entity as virtual_number_entity).properties.unit }}</p>
                </div>

                <!-- Virtual text - show the value only when the view config is label or for non-vertical widgets  -->
                <div v-else-if="
                    entity.type === 'text' &&
                    (!vertical || (entity as virtual_text_entity).properties.view === 'label') &&
                    device.online
                " class="box">
                    <p>{{ entity_status.value }}</p>
                </div>

                <div v-else-if="
                    entity.type === 'enum' &&
                    (entity as virtual_enum_entity).properties.view === 'label' &&
                    device.online
                " class="box">
                    <p>
                        {{
                            (entity as virtual_enum_entity).properties.options[entity_status.value] ??
                            entity_status.value
                        }}
                    </p>
                </div>

                <Dropdown v-else-if="
                    entity.type === 'enum' &&
                    (entity as virtual_enum_entity).properties.view === 'dropdown' &&
                    device.online
                " :default="(entity as virtual_enum_entity).properties.options[entity_status.value] || entity_status.value
                        " :options="Object.values((entity as virtual_enum_entity).properties.options)"
                    :disabled="!canExecute" @click.stop
                    @selected="
                        (selectedValue: string) => {
                            if (!canExecute) return;
                            const selectedKey = Object.entries(
                                (entity as virtual_enum_entity)?.properties?.options || {}
                            ).find(([_, value]) => value === selectedValue)?.[0];

                            if (!selectedKey) {
                                return;
                            }

                            sendRpc(entity.id, 'Enum.Set', { value: selectedKey });
                        }
                    " />

                <div v-else-if="entity.type === 'em1' || entity.type === 'pm1'" class="box">
                    <p>{{ formatWatts(entity_status.act_power ?? entity_status.apower) }}</p>
                </div>

                <div v-else-if="entity.type === 'input' && (entity as input_entity).properties.type === 'switch'"
                    class="w-10 h-10 p-2 rounded-md bg-[var(--color-surface-1)] text-[var(--color-text-primary)] box">
                    <p :key="String(entity_status.state)" class="my-auto text-base">
                        <i v-if="entity_status.state" class="fas fa-toggle-on text-[var(--color-success-text)]" />
                        <i v-else class="fas fa-toggle-off text-[var(--color-danger-text)]" />
                    </p>
                </div>

                <div v-else-if="entity.type === 'input' && (entity as input_entity).properties.type === 'analog'"
                    class="w-10 h-10 p-2 rounded-md bg-[var(--color-surface-1)] text-[var(--color-text-primary)] box">
                    <p>
                        {{ entity_status?.xpercent || entity_status.percent }}
                        {{ (entity as input_entity).properties.unit ?? '%' }}
                    </p>
                </div>

                <div v-else-if="entity.type === 'input' && (entity as input_entity).properties.type === 'button'"
                    class="w-10 h-10 p-2 rounded-md bg-[var(--color-surface-1)] text-[var(--color-text-primary)] box">
                    <p>{{ displayEvent }}</p>
                </div>

                <CoverControls v-if="entity.type === 'cover'" :state="entity_status.state"
                    :request-in-progress="waitingForResponse" :disabled="!canExecute" @direction="coverControl" />

                <button v-else-if="/(cct|switch|light|rgbw?|rgbcct)/.test(entity.type)" class="w-11 h-11 rounded-full flex items-center justify-center" :class="{
                    'bg-[var(--color-danger)]': !entity_status.output && canExecute,
                    'bg-[var(--color-success)]': entity_status.output && canExecute,
                    'bg-[var(--color-surface-3)] cursor-not-allowed opacity-50': !canExecute,
                }" :disabled="!canExecute" @click.stop="actionClicked">
                    <Spinner v-if="waitingForResponse" />
                    <template v-else>
                        <span>
                            <i class="fas fa-power-off"></i>
                        </span>
                    </template>
                </button>

                <!-- Cury (Scent Diffuser) controls - shows per-slot status -->
                <div v-else-if="entity.type === 'cury'" class="flex items-center gap-2">
                    <!-- Left slot indicator -->
                    <div
                        v-if="curySlotInfo.leftHasVial"
                        class="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold"
                        :class="{
                            'bg-[var(--color-success)]': entity_status.slots?.left?.on,
                            'bg-[var(--color-surface-3)]': !entity_status.slots?.left?.on
                        }"
                        :title="`Left: ${entity_status.slots?.left?.vial?.name || 'Vial'}`"
                    >
                        <span v-if="entity_status.slots?.left?.boost" class="text-[var(--color-warning-text)]">
                            <i class="fas fa-rocket"></i>
                        </span>
                        <span v-else>L</span>
                    </div>
                    <!-- Right slot indicator -->
                    <div
                        v-if="curySlotInfo.rightHasVial"
                        class="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold"
                        :class="{
                            'bg-[var(--color-success)]': entity_status.slots?.right?.on,
                            'bg-[var(--color-surface-3)]': !entity_status.slots?.right?.on
                        }"
                        :title="`Right: ${entity_status.slots?.right?.vial?.name || 'Vial'}`"
                    >
                        <span v-if="entity_status.slots?.right?.boost" class="text-[var(--color-warning-text)]">
                            <i class="fas fa-rocket"></i>
                        </span>
                        <span v-else>R</span>
                    </div>
                    <!-- Show message if no vials -->
                    <span v-if="!curySlotInfo.leftHasVial && !curySlotInfo.rightHasVial" class="text-[var(--color-text-tertiary)] text-xs">
                        No vials
                    </span>
                </div>

                <!-- Humidity sensor display -->
                <div v-else-if="entity.type === 'humidity'" class="box">
                    <p v-if="entity_status.rh !== null && entity_status.rh !== undefined">{{ entity_status.rh }} %</p>
                    <p v-else>N/A</p>
                </div>

                <!-- Voltmeter display -->
                <div v-else-if="entity.type === 'voltmeter'" class="box">
                    <p v-if="entity_status.voltage !== null && entity_status.voltage !== undefined">{{ entity_status.voltage }} V</p>
                    <p v-else>N/A</p>
                </div>
            </template>
        </template>
    </Widget>
</template>

<script lang="ts" setup>
import {computed, onMounted, onUnmounted, ref, toRef, toRefs, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import CoverControls from '@/components/core/Cover/CoverControls.vue';
import {getPredefinedImageForEntity} from '@/helpers/device';
import {formatWatts} from '@/helpers/numbers';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {debug} from '@/tools/debug';
import {
    type bthomesensor_entity,
    type entity_t,
    type input_entity,
    virtual_boolean_entity,
    virtual_enum_entity,
    virtual_number_entity,
    virtual_text_entity
} from '@/types';
import Dropdown from '../core/Dropdown.vue';
import HorizontalProgress from '../core/HorizontalProgress.vue';
import HorizontalSlider from '../core/HorizontalSlider.vue';
import Input from '../core/Input.vue';
import Spinner from '../core/Spinner.vue';
import Widget from './WidgetsTemplates/EntityWidget.vue';

type props_t = {
    entity: entity_t;
    editMode?: boolean;
    selected?: boolean;
    vertical?: boolean;
};

const props = withDefaults(defineProps<props_t>(), {
    editMode: false,
    selected: false,
    rightCorner: false
});
const emit = defineEmits<{
    delete: [];
}>();

const {editMode, selected, vertical} = toRefs(props);

const entityStore = useEntityStore();
const deviceStore = useDevicesStore();
const authStore = useAuthStore();
const entity = toRef(props, 'entity');

const device = computed(() => deviceStore.devices[entity.value.source]);

// Check if user can execute commands on this device
const canExecute = computed(() =>
    authStore.canExecuteDevice(entity.value.source)
);

const nameFitter = computed(() =>
    entity.value.name.length > 30
        ? entity.value.name.substring(0, 30) + '...'
        : entity.value.name
);

const checkIfVC = computed(() => {
    return (type: string) =>
        ['boolean', 'number', 'enum', 'text', 'group', 'button'].includes(type);
});

const entity_status = computed(() => {
    if (!device.value) {
        return {};
    }

    return device.value.status?.[
        entity.value.type + ':' + entity.value.properties.id
    ];
});

let eventListener: (() => void) | null = null;
const event = ref(null);
let clearEventTimeout: ReturnType<typeof setTimeout>;
let tempValue: string | number | any;

watch(device, (dev) => {
    debug('dev', dev);
});

watch(entity_status, (status) => {
    if (!['number', 'text'].includes(entity.value.type)) {
        return;
    }

    tempValue = status.value;
});

onMounted(() => {
    // events are needed only for buttons
    if (
        !(
            entity.value.type === 'button' ||
            (entity.value.type === 'bthomesensor' &&
                (entity.value as bthomesensor_entity).properties.sensorType ===
                    'button') ||
            (entity.value.type === 'input' &&
                (entity.value as input_entity).properties.type === 'button')
        )
    ) {
        return;
    }

    eventListener = entityStore.addListener(entity.value.id, (_event: any) => {
        event.value = _event;

        if (clearEventTimeout) {
            clearTimeout(clearEventTimeout);
        }

        clearEventTimeout = setTimeout(() => {
            event.value = null;
            clearTimeout(clearEventTimeout);
        }, 3000);
    });
});

onUnmounted(() => {
    if (typeof eventListener !== 'function') {
        return;
    }

    eventListener();
});

const displayEvent = computed(() => {
    if (!event.value) {
        return 'None';
    }

    const EVENT_TITLES: Record<string, string> = {
        single_push: 'Single Press',
        double_push: 'Double Press',
        triple_push: 'Triple Press',
        long_push: 'Long Press'
    };

    return EVENT_TITLES[event.value] ?? 'None';
});

const waitingForResponse = ref(false);
let waitingForResponseTimeout: ReturnType<typeof setTimeout>;
let lastActionTime = 0;

const tags = computed(() => {
    if (
        typeof entity_status.value !== 'object' ||
        Object.keys(entity_status.value).length == 0
    ) {
        return [];
    }

    const tags: {icon?: string; text: string}[] = [];

    // Handle Cury-specific tags
    if (entity.value.type === 'cury') {
        const status = entity_status.value;

        // Show per-slot status
        const leftSlot = status.slots?.left;
        const rightSlot = status.slots?.right;
        const leftHasVial =
            leftSlot?.vial?.serial &&
            leftSlot.vial.serial !== '0000000000000000';
        const rightHasVial =
            rightSlot?.vial?.serial &&
            rightSlot.vial.serial !== '0000000000000000';

        // Left slot status
        if (leftHasVial) {
            const leftName = leftSlot.vial.name || 'L';
            if (leftSlot.on) {
                tags.push({
                    text: `${leftName}: ${leftSlot.intensity}%`,
                    icon: 'fas fa-spray-can'
                });
            }
            if (leftSlot.boost) {
                tags.push({text: `${leftName} Boost`, icon: 'fas fa-rocket'});
            }
        }

        // Right slot status
        if (rightHasVial) {
            const rightName = rightSlot.vial.name || 'R';
            if (rightSlot.on) {
                tags.push({
                    text: `${rightName}: ${rightSlot.intensity}%`,
                    icon: 'fas fa-spray-can'
                });
            }
            if (rightSlot.boost) {
                tags.push({text: `${rightName} Boost`, icon: 'fas fa-rocket'});
            }
        }

        if (status.away_mode) {
            tags.push({text: 'Away', icon: 'fas fa-plane-departure'});
        }

        // Show vial levels
        if (
            leftHasVial &&
            typeof leftSlot.vial.level === 'number' &&
            leftSlot.vial.level >= 0
        ) {
            tags.push({text: `L:${leftSlot.vial.level}%`, icon: 'fas fa-vial'});
        }
        if (
            rightHasVial &&
            typeof rightSlot.vial.level === 'number' &&
            rightSlot.vial.level >= 0
        ) {
            tags.push({
                text: `R:${rightSlot.vial.level}%`,
                icon: 'fas fa-vial'
            });
        }

        if (status.errors?.length > 0) {
            tags.push({
                text: `${status.errors.length} error${status.errors.length > 1 ? 's' : ''}`,
                icon: 'fas fa-triangle-exclamation'
            });
        }
        return tags;
    }

    for (const [k, v] of Object.entries(entity_status.value)) {
        if (v == '0') continue;
        switch (k) {
            case 'apower':
            case 'act_power':
                tags.push({text: `${v} W`, icon: 'fas fa-bolt'});
                break;

            case 'aprt_power':
                tags.push({text: `${v} VA`, icon: 'fas fa-bolt'});
                break;

            case 'voltage':
                tags.push({text: `${v} V`});
                break;

            case 'total':
            case 'total_act':
                tags.push({text: `${v} Wh`});
                break;

            case 'current':
                tags.push({text: `${v} A`});
                break;

            case 'pf':
                tags.push({text: `PF ${v}`});
                break;

            case 'freq':
                tags.push({text: `${v} Hz`});
                break;

            case 'white':
                tags.push({text: String(v), icon: 'fa-solid fa-circle'});
                break;

            case 'brightness':
                tags.push({text: String(v), icon: 'fas fa-sun'});
                break;

            case 'temp':
                // Color temperature in Kelvin
                tags.push({text: `${v}K`, icon: 'fas fa-temperature-half'});
                break;

            case 'state': {
                if (entity.value.type !== 'cover') {
                    // skip the state for not covers
                    break;
                }

                tags.push({text: String(v)});
                break;
            }
        }
    }
    return tags;
});

async function sendRpc(entityId: string, method: string, params?: any) {
    // Check if user has execute permission
    if (!canExecute.value) {
        console.warn('User does not have execute permission for this device');
        return;
    }

    waitingForResponse.value = true;
    waitingForResponseTimeout = setTimeout(() => {
        waitingForResponse.value = false;
    }, 10000); // timeout after 10 seconds

    await entityStore.sendRPC(entityId, method, params);

    if (waitingForResponseTimeout) {
        clearInterval(waitingForResponseTimeout);
    }
    waitingForResponse.value = false;
}

function actionClicked() {
    if (
        !['switch', 'light', 'rgb', 'rgbw', 'cct', 'rgbcct'].includes(
            entity.value.type
        )
    ) {
        return;
    }

    if (waitingForResponse.value) {
        return;
    }

    // Debounce: prevent accidental double-toggles (e.g. trackpad double-tap)
    const now = Date.now();
    if (now - lastActionTime < 100) {
        return;
    }
    lastActionTime = now;

    sendRpc(entity.value.id, `${entity.value.type}.toggle`);
}

function coverControl(direction: 'stop' | 'open' | 'close') {
    if (entity.value.type !== 'cover') {
        return;
    }

    if (waitingForResponse.value) {
        return;
    }

    sendRpc(entity.value.id, `${entity.value.type}.${direction}`);
}

// Cury slot info for widget display
const curySlotInfo = computed(() => {
    if (entity.value.type !== 'cury') {
        return {leftHasVial: false, rightHasVial: false};
    }
    const status = entity_status.value;
    const leftSerial = status?.slots?.left?.vial?.serial;
    const rightSerial = status?.slots?.right?.vial?.serial;
    return {
        leftHasVial: leftSerial && leftSerial !== '0000000000000000',
        rightHasVial: rightSerial && rightSerial !== '0000000000000000'
    };
});
</script>

<style scoped>
@reference "tailwindcss";
.box {
    @apply p-1 md:p-2 w-max rounded-md bg-[var(--color-surface-1)] text-[var(--color-text-primary)] h-10 flex items-center;
}

.box>p {
    @apply text-xs md:text-sm line-clamp-1;
}

.typeIcon {
    font-size: 28px;
    color: white;
    display: absolute;
    top: 50%;
    left: 100%;
}

.image-container {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100%;
}
</style>

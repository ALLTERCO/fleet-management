<template>
    <Widget :vertical="vertical" board :selected="selected" :vc="checkIfVC(entity.type)"
        :class="[(!device || device.loading || !device.online) && 'widget-card--offline']">

        <template #upper-corner>Entity</template>

        <template v-if="!device" #status>
            <span class="device-card__pill-off">
                <span class="device-card__pill-dot"></span> ERROR
            </span>
        </template>
        <template v-else-if="sensorError" #status>
            <span class="entity-card__pill-error" :title="sensorError!">
                <i class="fas fa-triangle-exclamation"></i> {{ sensorError }}
            </span>
        </template>
        <template v-else-if="device.sleeping" #status>
            <span class="device-card__pill-sleep">
                <i class="fas fa-moon"></i> Sleeping
            </span>
        </template>
        <template v-else-if="!device.online && !device.loading" #status>
            <span class="device-card__pill-off">
                <span class="device-card__pill-dot"></span> OFFLINE
            </span>
        </template>

        <template #image>
            <div class="image-container">
                <i v-lazyload class="rounded-full typeIcon" :class="getPredefinedImageForEntity(entity.type, entity.properties)"
                    alt="Shelly"></i>
            </div>
        </template>

        <template #name>
            <span class="text-[length:var(--type-caption)] text-wrap text-center truncate line-clamp-2"> {{ nameFitter }}</span>
        </template>

        <template #description>
            <div v-if="device?.loading" class="mx-auto">
                <Spinner />
            </div>
            <div v-else-if="device?.online" class="flex select-none gap-1.5 flex-col mt-1">
                <!-- Show the color of the RGBW, RGB, RGBCCT lights, and light entities with RGB support -->
                <div class="flex flex-wrap gap-1.5">
                    <span v-if="((/rgbw?|rgbcct/i.test(entity.type)) || (entity.type === 'light' && entity_status?.rgb)) && device.online && safeRgbStyle"
                        class="entity-tag"
                        role="img" :aria-label="`Color: RGB(${entity_status.rgb.join(', ')})`">
                        <p class="border-2 rounded-full" aria-hidden="true"
                            :style="safeRgbStyle">
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
                        && (entity as virtual_number_entity).properties.min !== undefined
                        && (entity as virtual_number_entity).properties.max !== undefined
                    " :value="entity_status.value" :min="(entity as virtual_number_entity).properties.min"
                        :max="(entity as virtual_number_entity).properties.max"
                        :step="(entity as virtual_number_entity).properties.step ?? 1"
                        :disable="waitingForResponse || !device.online || !canExecute"
                        @change="(value: number) => invokeAction(entity.id, 'setValue', { value })">
                        <template #title>
                            {{ entity_status.value }} {{ (entity as virtual_number_entity).properties.unit ?? '' }}
                        </template>
                    </HorizontalSlider>

                    <HorizontalProgress v-if="
                        entity.type === 'number' &&
                        (entity as virtual_number_entity).properties.view === 'progressbar'
                        && (entity as virtual_number_entity).properties.min !== undefined
                        && (entity as virtual_number_entity).properties.max !== undefined
                    " :value="entity_status.value" :min="(entity as virtual_number_entity).properties.min"
                        :max="(entity as virtual_number_entity).properties.max"
                        :step="(entity as virtual_number_entity).properties.step ?? 1" :disable="!device.online"
                        @change="(value: number) => invokeAction(entity.id, 'setValue', { value })">
                    </HorizontalProgress>

                    <form
                        v-if="entity.type === 'number' && (entity as virtual_number_entity).properties.view === 'field'"
                        class="flex flex-col items-center gap-1"
                        @submit.prevent="() => invokeAction(entity.id, 'setValue', { value: tempValue })">
                        <Input v-model="tempValue" :type="'number'" :placeholder="'Value'" :disabled="!canExecute" />
                        <Button type="blue" submit size="xs" :disabled="!canExecute">Save</Button>
                    </form>
                    <form v-if="entity.type === 'text' && (entity as virtual_text_entity).properties.view === 'field'"
                        class="flex flex-col items-center gap-1"
                        @submit.prevent="() => invokeAction(entity.id, 'setValue', { value: tempValue })">
                        <Input v-model="tempValue" :type="'text'" :placeholder="'Value'"
                            :max="(entity as virtual_text_entity).properties.maxLength" :disabled="!canExecute" />
                        <Button type="blue" submit size="xs" :disabled="!canExecute">Save</Button>
                    </form>
                </div>
            </div>
        </template>

        <template v-if="device" #action>
            <template v-if="editMode">
                <Button type="red" @click="emit('delete')">Delete</Button>
            </template>
            <template v-else-if="entity_status && device.online && !device.loading">
                <div v-if="entity.properties?.errors?.length" class="box entity-error-box" :title="entity.properties.errors.join(', ')">
                    <p><i class="fas fa-exclamation-triangle" style="color: var(--color-warning-text)" /></p>
                </div>
                <div v-else-if="entity.type === 'temperature'" class="box">
                    <p v-if="entity_status.tC !== null">{{ entity_status.tC }} °C</p>
                    <p v-else>N/A</p>
                </div>

                <div v-else-if="entity.type === 'flood'" class="box">
                    <p :style="entity_status.alarm === true ? 'color: var(--color-danger-text)' : entity_status.alarm === null ? 'color: var(--color-warning-text)' : ''">
                        {{ entity_status.alarm === true ? 'FLOOD' : entity_status.alarm === false ? 'Dry' : 'Error' }}
                    </p>
                    <p v-if="entityStringProp('alarm_mode') === 'rain'" style="margin-left: 0.5rem; opacity: 0.7"><i class="fas fa-cloud-rain" /> Rain</p>
                    <p v-if="entity_status.mute" style="margin-left: 0.5rem; color: var(--color-warning-text)"><i class="fas fa-volume-mute" /> Muted</p>
                </div>

                <div v-else-if="entity.type === 'smoke'" class="box">
                    <p :style="entity_status.alarm === true ? 'color: var(--color-danger-text)' : ''">
                        {{ entity_status.alarm === true ? 'SMOKE' : entity_status.alarm === false ? 'Clear' : 'N/A' }}
                    </p>
                </div>

                <div v-else-if="entity.type === 'devicepower'" class="box">
                    <p v-if="entity_status.battery">{{ entity_status.battery.percent }}%</p>
                    <p v-else-if="entity_status.external?.present"><i class="fas fa-plug" /> AC</p>
                    <p v-else>—</p>
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
                    <p>{{ binaryStateLabel }}</p>
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
                    }" :disabled="!canExecute" :aria-label="entity_status.value ? 'Turn off' : 'Turn on'" @click.stop="() => invokeAction(entity.id, 'setValue', { value: !entity_status.value })">
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
                    <p>{{ entity_status.value }} {{ (entity as virtual_number_entity).properties.unit ?? '' }}</p>
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
                            ((entity as virtual_enum_entity).properties.options ?? {})[entity_status.value] ??
                            entity_status.value
                        }}
                    </p>
                </div>

                <Dropdown v-else-if="
                    entity.type === 'enum' &&
                    (entity as virtual_enum_entity).properties.view === 'dropdown' &&
                    device.online
                " :default="((entity as virtual_enum_entity).properties.options ?? {})[entity_status.value] || entity_status.value
                        " :options="Object.values((entity as virtual_enum_entity).properties.options ?? {})"
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

                            invokeAction(entity.id, 'setValue', { value: selectedKey });
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
                }" :disabled="!canExecute" :aria-label="entity_status.output ? 'Turn off' : 'Turn on'" @click.stop="actionClicked">
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
                        role="img"
                        :class="{
                            'bg-[var(--color-success)]': entity_status.slots?.left?.on,
                            'bg-[var(--color-surface-3)]': !entity_status.slots?.left?.on
                        }"
                        :aria-label="`Left slot: ${entity_status.slots?.left?.on ? 'active' : 'inactive'}`"
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
                        role="img"
                        :class="{
                            'bg-[var(--color-success)]': entity_status.slots?.right?.on,
                            'bg-[var(--color-surface-3)]': !entity_status.slots?.right?.on
                        }"
                        :aria-label="`Right slot: ${entity_status.slots?.right?.on ? 'active' : 'inactive'}`"
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

                <!-- Illuminance (Wall Display light sensor) -->
                <div v-else-if="entity.type === 'illuminance'" class="box">
                    <p v-if="entity_status.lux != null">{{ entity_status.lux }} lux</p>
                    <p v-else>N/A</p>
                </div>

                <!-- Thermostat (Wall Display HVAC) -->
                <div v-else-if="entity.type === 'thermostat'" class="box">
                    <p v-if="entity_status.current_C != null">{{ entity_status.current_C }}°C</p>
                    <p v-else>N/A</p>
                </div>

                <!-- Media (Wall Display player) -->
                <div v-else-if="entity.type === 'media'" class="box">
                    <p>{{ entity_status.playback?.enable ? 'Playing' : 'Stopped' }}</p>
                </div>

                <!-- UI / Display (Wall Display screen) -->
                <div v-else-if="entity.type === 'ui'" class="box">
                    <p><i class="fas fa-display" /></p>
                </div>

                <!-- Group (virtual component container) -->
                <div v-else-if="entity.type === 'group'" class="box">
                    <p><i class="fas fa-layer-group" /></p>
                    <p style="font-size:var(--type-caption);opacity:.7">{{ (entity_status?.value?.length ?? 0) }} members</p>
                </div>

                <!-- BTHome Device (physical BLE device) -->
                <div v-else-if="entity.type === 'bthomedevice'" class="box">
                    <p><i class="fab fa-bluetooth-b" style="color:var(--color-ble)" /></p>
                    <p style="font-size:var(--type-caption);opacity:.7">{{ entityStringProp('productName') || 'BLE Device' }}</p>
                </div>

                <!-- BTHome Control (BLE remote button/dimmer) -->
                <div v-else-if="entity.type === 'bthomecontrol'" class="box">
                    <p><i class="fas fa-gamepad" /></p>
                </div>

                <!-- XT1 Service device (Powered by Shelly / Shelly X) -->
                <div v-else-if="entity.type === 'service'" class="box" style="gap:var(--space-1)">
                    <!-- HVAC: temp + mode + fan -->
                    <template v-if="vcVal('current_temperature') != null">
                        <p class="ew-svc__value">{{ formatServiceValue(vcVal('current_temperature'), 1) }}°C</p>
                        <div class="ew-svc__meta">
                            <span v-if="vcVal('working_mode')">{{ vcVal('working_mode') }}</span>
                            <span v-if="vcVal('fan_speed')">Fan: {{ vcVal('fan_speed') }}</span>
                        </div>
                        <p v-if="vcVal('target_temperature') != null" class="ew-svc__sub">Target: {{ vcVal('target_temperature') }}°C</p>
                    </template>
                    <!-- Valve: position + buttons -->
                    <template v-else-if="vcVal('position') != null">
                        <p class="ew-svc__value">{{ vcVal('position') }}%</p>
                        <div v-if="canExecute" class="ec-cbtns">
                            <button class="ec-cbtn" @click.stop="vcTriggerBtn('open')"><i class="fas fa-chevron-up" /> Open</button>
                            <button class="ec-cbtn" @click.stop="vcTriggerBtn('close')"><i class="fas fa-chevron-down" /> Close</button>
                        </div>
                    </template>
                    <!-- EV Charger: state + energy -->
                    <template v-else-if="vcVal('work_state')">
                        <p class="ew-svc__value ew-svc__value--sm">{{ vcVal('work_state') }}</p>
                        <p v-if="vcVal('energy_charge') != null" class="ew-svc__sub">{{ vcVal('energy_charge') }} kWh</p>
                    </template>
                    <!-- Generic fallback -->
                    <template v-else>
                        <p>{{ entityStringProp('productName') || 'Service' }}</p>
                    </template>
                </div>

                <!-- Matter -->
                <div v-else-if="entity.type === 'matter'" class="box">
                    <p :style="device.settings?.['matter:0']?.enable ? 'color: var(--color-success-text)' : 'color: var(--color-text-disabled)'">
                        {{ device.settings?.['matter:0']?.enable ? 'Enabled' : 'Disabled' }}
                    </p>
                </div>
            </template>
        </template>
    </Widget>
</template>

<script lang="ts" setup>
import {computed, onMounted, onUnmounted, ref, toRef, toRefs, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import CoverControls from '@/components/core/Cover/CoverControls.vue';
import {getBThomeBinaryStateWords} from '@/config/bthome-presentation';
import {getEntityDef} from '@/config/entity-registry';
import {getPredefinedImageForEntity} from '@/helpers/device';
import {isInstantEntityAction} from '@/helpers/instantEntityActions';
import {formatWatts} from '@/helpers/numbers';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useToastStore} from '@/stores/toast';
import {debug} from '@/tools/debug';
import {
    type bthomesensor_entity,
    type entity_t,
    type input_entity,
    type shelly_device_t,
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
    // Draft previews render from this device — it never enters the devices store.
    sourceDevice?: shelly_device_t | null;
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
const toastStore = useToastStore();
const entity = toRef(props, 'entity');

const device = computed(
    () => props.sourceDevice ?? deviceStore.devices[entity.value.source]
);

// Check if user can execute commands on this device
const canExecute = computed(() =>
    authStore.canExecuteDevice(entity.value.source)
);

const nameFitter = computed(() => entity.value.name);

type EntityPropertyRecord = Record<string, unknown>;
type ComponentResourceMap = Record<string, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function currentEntityProps(): EntityPropertyRecord {
    return entity.value.properties as EntityPropertyRecord;
}

function entityStringProp(key: string): string | undefined {
    const value = currentEntityProps()[key];
    return typeof value === 'string' ? value : undefined;
}

function componentResources(): ComponentResourceMap | null {
    const value = currentEntityProps().components;
    if (!isRecord(value)) return null;
    const entries = Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
    );
    return Object.fromEntries(entries);
}

function currentStatusRecord(): Record<string, unknown> | null {
    return isRecord(entity_status.value) ? entity_status.value : null;
}

function statusErrors(): string[] {
    const errors = currentStatusRecord()?.errors;
    return Array.isArray(errors)
        ? errors.filter((item): item is string => typeof item === 'string')
        : [];
}

function statusTemperatureC(): number | null {
    const temperature = currentStatusRecord()?.temperature;
    if (!isRecord(temperature)) return null;
    const value = temperature.tC;
    return typeof value === 'number' ? value : null;
}

const checkIfVC = computed(() => {
    return (type: string) =>
        ['boolean', 'number', 'enum', 'text', 'group', 'button'].includes(type);
});

/** Validate RGB array values are finite numbers in 0-255 and return a safe CSS color string */
const safeRgbStyle = computed(() => {
    const rgb = entity_status.value?.rgb;
    if (!Array.isArray(rgb) || rgb.length < 3) return undefined;
    const [r, g, b] = rgb;
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b))
        return undefined;
    const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
    return `width: 18px; height: 18px; background-color: rgb(${clamp(r)},${clamp(g)},${clamp(b)});`;
});

// Binary state words are presentation, keyed on the backend-sent objName.
const binaryStateLabel = computed(() => {
    const objName = (entity.value as bthomesensor_entity).properties?.objName;
    const on = Boolean((entity_status.value as {value?: unknown}).value);
    const words = getBThomeBinaryStateWords(objName);
    return on ? words.on : words.off;
});

const entity_status = computed(() => {
    if (!device.value) {
        return {};
    }
    const e = entity.value;
    const embedded = e.properties.embeddedIn;
    if (e.type === 'temperature' && embedded) {
        return device.value.status?.[embedded]?.temperature ?? {};
    }
    const statusKey = `${e.type}:${e.properties?.id}`;
    // statusOf reads the devices store — a passed-in preview device is not there.
    if (props.sourceDevice) {
        return props.sourceDevice.status?.[statusKey];
    }
    return deviceStore.statusOf(entity.value.source, statusKey);
});

// Service entity: read virtual component value by resource role
function vcVal(resource: string): unknown {
    const components = componentResources();
    if (!components || !device.value) return null;
    const key = components[resource];
    if (!key) return null;
    return deviceStore.statusOf(entity.value.source, key)?.value ?? null;
}

function formatServiceValue(value: unknown, fractionDigits = 0): string {
    if (typeof value === 'number') return value.toFixed(fractionDigits);
    return value == null ? '' : String(value);
}

// Service entity: trigger a button component
function vcTriggerBtn(resource: string) {
    const components = componentResources();
    if (!components || !device.value) return;
    const key = components[resource];
    if (!key) return;
    void invokeAction(entity.value.id, 'trigger', {
        key,
        event: 'single_push'
    });
}

// Detect sensor errors (alarm:null + errors array, or smoke:null + errors)
const sensorError = computed<string | null>(() => {
    const s = currentStatusRecord();
    if (!s) return null;
    // Only for sensor types where null means error
    const hasNullAlarm = 'alarm' in s && s.alarm === null;
    const hasNullSmoke = 'smoke' in s && s.smoke === null;
    if (!hasNullAlarm && !hasNullSmoke) return null;
    const errArr = s.errors;
    if (Array.isArray(errArr) && errArr.length) {
        return String(errArr[0])
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (c: string) => c.toUpperCase());
    }
    return 'Sensor Error';
});

let eventListener: (() => void) | null = null;
const event = ref(null);
let clearEventTimeout: ReturnType<typeof setTimeout>;
const tempValue = ref<string | number>('');

watch(entity_status, (status) => {
    if (!['number', 'text'].includes(entity.value.type)) {
        return;
    }

    tempValue.value = status.value;
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
        }, 3000);
    });
});

onUnmounted(() => {
    if (clearEventTimeout) clearTimeout(clearEventTimeout);
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
let waitingForResponseTimeout: ReturnType<typeof setTimeout> | undefined;
let lastActionTime = 0;

const tags = computed(() => {
    if (
        typeof entity_status.value !== 'object' ||
        Object.keys(entity_status.value).length === 0
    ) {
        return [];
    }

    // Check registry for type-specific tag builder
    const def = getEntityDef(entity.value.type);
    if (def?.tags) {
        return def.tags(entity_status.value, entity.value.properties);
    }

    // Generic tag builder — covers switch, light, cover, em, pm1, em1,
    // temperature, humidity, flood, smoke, devicepower, voltmeter, input, etc.
    const tags: {icon?: string; text: string}[] = [];

    // Device profile / source indicator
    const ent = entity.value;
    const profile = ent.properties.deviceProfile;
    const source = (ent.properties as Record<string, any>)?.sensorSource;
    const embedded =
        ent.type === 'temperature' ? ent.properties.embeddedIn : undefined;
    if (embedded) {
        tags.push({text: 'Internal', icon: 'fas fa-microchip'});
    } else if (profile === 'dali') {
        tags.push({text: 'DALI', icon: 'fas fa-network-wired'});
    } else if (source === 'blu' || ent.type === 'bthomesensor') {
        tags.push({text: 'BLU', icon: 'fab fa-bluetooth-b'});
    } else if (source === 'addon') {
        tags.push({text: 'Add-on', icon: 'fas fa-puzzle-piece'});
    }

    for (const [k, v] of Object.entries(entity_status.value)) {
        if (v === '0') continue;
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
                tags.push({text: String(v), icon: 'fas fa-circle'});
                break;
            case 'brightness':
                tags.push({text: String(v), icon: 'fas fa-sun'});
                break;
            case 'temp':
            case 'ct':
                tags.push({text: `${v}K`, icon: 'fas fa-temperature-half'});
                break;
            case 'state':
                if (entity.value.type === 'cover') tags.push({text: String(v)});
                break;
            case 'alarm':
                if (v === true) {
                    tags.push({
                        text: 'FLOOD',
                        icon: 'fas fa-triangle-exclamation'
                    });
                } else if (v === false) {
                    tags.push({text: 'Dry', icon: 'fas fa-check-circle'});
                } else {
                    const errArr = statusErrors();
                    const errText =
                        Array.isArray(errArr) && errArr.length
                            ? String(errArr[0])
                                  .replace(/_/g, ' ')
                                  .replace(/\b\w/g, (c: string) =>
                                      c.toUpperCase()
                                  )
                            : 'Error';
                    tags.push({
                        text: errText,
                        icon: 'fas fa-triangle-exclamation'
                    });
                }
                break;
        }
    }

    // Nested: PCB/internal temperature (light, switch, cover, bulb)
    const tC = statusTemperatureC();
    if (tC != null) {
        tags.push({text: `${tC}°C`, icon: 'fas fa-microchip'});
    }

    return tags;
});

async function invokeAction(
    entityId: string,
    action: string,
    params?: Record<string, unknown>
) {
    // :disabled on the controls already blocks unauthorized clicks; the
    // backend re-checks. No silent return — the catch below surfaces any
    // permission rejection via toast.
    const instantAction = isInstantEntityAction(entity.value.type, action);
    if (!instantAction) {
        waitingForResponse.value = true;
        waitingForResponseTimeout = setTimeout(() => {
            waitingForResponse.value = false;
        }, 10000);
    }

    try {
        await entityStore.invokeAction(entityId, action, params);
    } catch (err) {
        toastStore.error(commandErrorMessage(action, err));
        debug('[EntityWidget] command failed', err);
    } finally {
        if (waitingForResponseTimeout) {
            clearTimeout(waitingForResponseTimeout);
            waitingForResponseTimeout = undefined;
        }
        if (!instantAction) {
            waitingForResponse.value = false;
        }
    }
}

function commandErrorMessage(action: string, err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes('timeout')) {
        return `${action} timed out — device may still apply it`;
    }
    return `${action} failed`;
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

    void invokeAction(entity.value.id, 'setOutput', {
        on: !entity_status.value?.output
    });
}

function coverControl(direction: 'stop' | 'open' | 'close') {
    if (entity.value.type !== 'cover') {
        return;
    }

    if (waitingForResponse.value) {
        return;
    }

    void invokeAction(entity.value.id, direction);
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
    @apply text-[length:var(--type-caption)] md:text-[length:var(--type-body)] line-clamp-1;
}

.entity-error-box {
    @apply w-auto cursor-help;
}

.typeIcon {
    font-size: var(--type-subheading);
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

/* Service entity value styles — replaces inline styles */
.ew-svc__value { font-size: var(--type-body); font-weight: 700; }
.ew-svc__value--sm { font-size: var(--type-body); font-weight: 600; }
.ew-svc__meta { display: flex; gap: var(--gap-xs); font-size: var(--type-body); color: var(--color-text-tertiary); }
.ew-svc__sub { font-size: var(--type-body); color: var(--color-text-quaternary); }
</style>

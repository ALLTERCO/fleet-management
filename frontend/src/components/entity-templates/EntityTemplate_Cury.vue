<template>
    <div class="flex flex-col gap-2">
        <!-- Left Slot -->
        <div class="flex flex-col gap-2 p-3 bg-[var(--color-surface-2)] rounded-lg">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <span class="text-sm font-semibold text-[var(--color-text-primary)]">Left Slot</span>
                    <span v-if="status?.slots?.left?.vial?.name" class="text-xs text-[var(--color-text-tertiary)]">
                        ({{ status.slots.left.vial.name }})
                    </span>
                    <span v-if="getVialFault('left')" class="text-xs text-[var(--color-danger-text)]">
                        — {{ getVialFault('left') }}
                    </span>
                </div>
                <span v-if="status?.slots?.left?.on" class="et-cury__status-dot et-cury__status-dot--on" />
                <span v-else-if="isSlotAvailable('left')" class="et-cury__status-dot" />
                <span v-else class="text-xs text-[var(--color-text-disabled)]">No vial</span>
            </div>
            <div v-if="isSlotAvailable('left')" class="flex flex-col gap-2">
                <!-- Intensity presets -->
                <div class="et-cury__presets">
                    <button v-for="p in PRESETS" :key="p.value" class="et-cury__preset" :class="(status?.slots?.left?.intensity ?? 50) === p.value && 'et-cury__preset--act'" :disabled="!canExecute" @click="emit('set-intensity', 'left', p.value)">{{ p.label }}</button>
                </div>
                <HorizontalSlider
                    :value="status?.slots?.left?.intensity ?? 50"
                    :min="0" :max="100" :step="1"
                    :disable="!canExecute"
                    @change="(v: number) => emit('set-intensity', 'left', v)"
                >
                    <template #title>Intensity {{ status?.slots?.left?.intensity ?? 0 }}%</template>
                </HorizontalSlider>
                <div class="et-cury__slot-actions">
                    <button v-if="!status?.slots?.left?.on" class="et-cury__action-btn" :disabled="!canExecute" @click="emit('toggle-slot', 'left', true)"><i class="fas fa-play" /> Start</button>
                    <button v-else class="et-cury__action-btn et-cury__action-btn--stop" :disabled="!canExecute" @click="emit('toggle-slot', 'left', false)"><i class="fas fa-stop" /> Stop</button>
                    <button v-if="!status?.slots?.left?.boost" class="et-cury__action-btn" :disabled="!canExecute" @click="emit('boost', 'left')"><i class="fas fa-rocket" /> Boost</button>
                    <button v-else class="et-cury__action-btn et-cury__action-btn--stop" :disabled="!canExecute" @click="emit('stop-boost', 'left')"><i class="fas fa-stop" /> Stop Boost</button>
                </div>
            </div>
            <div v-if="status?.slots?.left?.boost" class="et-cury__boost-info">
                <i class="fas fa-rocket" /> Boost: {{ boostRemaining(status.slots.left.boost) }}
            </div>
            <div class="et-cury__vial-info">
                <div v-if="vialInfo?.left?.color_intensity?.rgb" class="et-cury__vial-color" :style="{background: `rgb(${vialInfo.left.color_intensity.rgb.join(',')})`}" />
                <span class="text-[var(--color-text-tertiary)]">{{ formatVialLevel(status?.slots?.left?.vial) }}</span>
                <span v-if="vialInfo?.left?.mfr_name" class="text-xs text-[var(--color-text-disabled)]">{{ vialInfo.left.mfr_name }}</span>
                <span v-if="vialInfo?.left?.exp_date" class="text-xs text-[var(--color-text-disabled)]">exp {{ vialInfo.left.exp_date }}</span>
            </div>
            <div v-if="status?.slots?.left?.timer" class="text-xs text-[var(--color-warning-text)]">
                <i class="fas fa-hourglass-half"></i> Timer: {{ formatDuration(status.slots.left.timer.timer_duration) }}
            </div>
        </div>

        <!-- Right Slot -->
        <div class="flex flex-col gap-2 p-3 bg-[var(--color-surface-2)] rounded-lg">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <span class="text-sm font-semibold text-[var(--color-text-primary)]">Right Slot</span>
                    <span v-if="status?.slots?.right?.vial?.name" class="text-xs text-[var(--color-text-tertiary)]">
                        ({{ status.slots.right.vial.name }})
                    </span>
                    <span v-if="getVialFault('right')" class="text-xs text-[var(--color-danger-text)]">
                        — {{ getVialFault('right') }}
                    </span>
                </div>
                <span v-if="status?.slots?.right?.on" class="et-cury__status-dot et-cury__status-dot--on" />
                <span v-else-if="isSlotAvailable('right')" class="et-cury__status-dot" />
                <span v-else class="text-xs text-[var(--color-text-disabled)]">No vial</span>
            </div>
            <div v-if="isSlotAvailable('right')" class="flex flex-col gap-2">
                <!-- Intensity presets -->
                <div class="et-cury__presets">
                    <button v-for="p in PRESETS" :key="p.value" class="et-cury__preset" :class="(status?.slots?.right?.intensity ?? 50) === p.value && 'et-cury__preset--act'" :disabled="!canExecute" @click="emit('set-intensity', 'right', p.value)">{{ p.label }}</button>
                </div>
                <HorizontalSlider
                    :value="status?.slots?.right?.intensity ?? 50"
                    :min="0" :max="100" :step="1"
                    :disable="!canExecute"
                    @change="(v: number) => emit('set-intensity', 'right', v)"
                >
                    <template #title>Intensity {{ status?.slots?.right?.intensity ?? 0 }}%</template>
                </HorizontalSlider>
                <div class="et-cury__slot-actions">
                    <button v-if="!status?.slots?.right?.on" class="et-cury__action-btn" :disabled="!canExecute" @click="emit('toggle-slot', 'right', true)"><i class="fas fa-play" /> Start</button>
                    <button v-else class="et-cury__action-btn et-cury__action-btn--stop" :disabled="!canExecute" @click="emit('toggle-slot', 'right', false)"><i class="fas fa-stop" /> Stop</button>
                    <button v-if="!status?.slots?.right?.boost" class="et-cury__action-btn" :disabled="!canExecute" @click="emit('boost', 'right')"><i class="fas fa-rocket" /> Boost</button>
                    <button v-else class="et-cury__action-btn et-cury__action-btn--stop" :disabled="!canExecute" @click="emit('stop-boost', 'right')"><i class="fas fa-stop" /> Stop Boost</button>
                </div>
            </div>
            <div v-if="status?.slots?.right?.boost" class="et-cury__boost-info">
                <i class="fas fa-rocket" /> Boost: {{ boostRemaining(status.slots.right.boost) }}
            </div>
            <div class="et-cury__vial-info">
                <div v-if="vialInfo?.right?.color_intensity?.rgb" class="et-cury__vial-color" :style="{background: `rgb(${vialInfo.right.color_intensity.rgb.join(',')})`}" />
                <span class="text-[var(--color-text-tertiary)]">{{ formatVialLevel(status?.slots?.right?.vial) }}</span>
                <span v-if="vialInfo?.right?.mfr_name" class="text-xs text-[var(--color-text-disabled)]">{{ vialInfo.right.mfr_name }}</span>
                <span v-if="vialInfo?.right?.exp_date" class="text-xs text-[var(--color-text-disabled)]">exp {{ vialInfo.right.exp_date }}</span>
            </div>
            <div v-if="status?.slots?.right?.timer" class="text-xs text-[var(--color-warning-text)]">
                <i class="fas fa-hourglass-half"></i> Timer: {{ formatDuration(status.slots.right.timer.timer_duration) }}
            </div>
        </div>

        <!-- Ambient Light -->
        <div class="flex flex-col gap-2 p-3 bg-[var(--color-surface-2)] rounded-lg">
            <span class="text-sm font-semibold text-[var(--color-text-primary)]">Ambient Light</span>
            <div class="flex items-center gap-3">
                <ColorWheel :rgb="ambientColor" @change="(rgb: [number, number, number]) => emit('set-ambient-color', rgb)" />
                <div class="flex flex-col gap-1 text-sm">
                    <span class="text-[var(--color-text-tertiary)]">Current color</span>
                    <div class="flex items-center gap-2">
                        <div
                            class="w-6 h-6 rounded-full border border-[var(--color-border-strong)]"
                            :style="{ backgroundColor: `rgb(${ambientColor.join(',')})` }"
                        ></div>
                        <span class="text-[var(--color-text-secondary)] font-mono text-xs">
                            {{ ambientColor.join(', ') }}
                        </span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Away Mode -->
        <div class="flex items-center justify-between p-3 bg-[var(--color-surface-2)] rounded-lg">
            <span class="text-sm text-[var(--color-text-primary)]">Away Mode</span>
            <button
                class="w-10 h-10 rounded-full"
                :class="{
                    'bg-[var(--color-success)]': status?.away_mode,
                    'bg-[var(--color-surface-4)]': !status?.away_mode
                }"
                :disabled="!canExecute"
                @click="emit('toggle-away-mode', !(status?.away_mode ?? false))"
            >
                <i class="fas" :class="status?.away_mode ? 'fa-plane-departure' : 'fa-home'"></i>
            </button>
        </div>

        <!-- Mode selector -->
        <div v-if="canExecute" class="flex items-center justify-between p-3 bg-[var(--color-surface-2)] rounded-lg">
            <span class="text-sm text-[var(--color-text-primary)]">Mode</span>
            <select
                class="text-sm bg-[var(--color-surface-3)] border border-[var(--color-border-default)] rounded px-2 py-1 text-[var(--color-text-primary)]"
                :value="status?.mode ?? 'null'"
                @change="(e: Event) => setMode((e.target as HTMLSelectElement).value)"
            >
                <option value="null">Manual</option>
                <option value="hall">Hall</option>
                <option value="bedroom">Bedroom</option>
                <option value="living_room">Living Room</option>
                <option value="lavatory_room">Lavatory</option>
                <option value="reception">Reception</option>
                <option value="workplace">Workplace</option>
            </select>
        </div>

        <!-- Vial Info -->
        <div v-if="vialInfo" class="flex flex-col gap-1 p-3 bg-[var(--color-surface-2)] rounded-lg">
            <span class="text-sm font-semibold text-[var(--color-text-primary)]">Vial Details</span>
            <div v-for="slot in ['left', 'right']" :key="slot">
                <div v-if="vialInfo[slot]" class="text-xs text-[var(--color-text-tertiary)]">
                    <span class="font-semibold text-[var(--color-text-secondary)]">{{ slot === 'left' ? 'Left' : 'Right' }}:</span>
                    {{ vialInfo[slot].product_name || 'Unknown' }}
                    <span v-if="vialInfo[slot].exp_date"> · exp {{ vialInfo[slot].exp_date }}</span>
                </div>
            </div>
        </div>

        <!-- Settings -->
        <div v-if="canExecute && shellyID && settings" class="flex flex-col gap-2 p-3 bg-[var(--color-surface-2)] rounded-lg">
            <div class="flex items-center gap-2 cursor-pointer" @click="showSettings = !showSettings">
                <i class="fas fa-gear text-[var(--color-text-tertiary)]"></i>
                <span class="text-sm font-semibold text-[var(--color-text-tertiary)]">Settings</span>
                <i class="fas text-xs text-[var(--color-text-disabled)] ml-auto" :class="showSettings ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
            </div>
            <template v-if="showSettings">
                <div v-if="settings.name != null" class="flex items-center justify-between text-sm">
                    <span class="text-[var(--color-text-disabled)]">Name</span>
                    <input type="text" class="bg-[var(--color-surface-3)] border border-[var(--color-border-default)] rounded px-2 py-1 text-sm text-[var(--color-text-primary)] w-40"
                        :value="settings.name" placeholder="Device name"
                        @change="(e: Event) => setConfig({name: (e.target as HTMLInputElement).value})" />
                </div>
                <div v-if="settings.boost_time != null" class="flex items-center justify-between text-sm">
                    <span class="text-[var(--color-text-disabled)]">Boost time</span>
                    <div class="flex items-center gap-1">
                        <input type="number" class="bg-[var(--color-surface-3)] border border-[var(--color-border-default)] rounded px-2 py-1 text-sm text-[var(--color-text-primary)] w-20 text-center"
                            :value="settings.boost_time" min="60"
                            @change="(e: Event) => setConfig({boost_time: Number((e.target as HTMLInputElement).value)})" />
                        <span class="text-xs text-[var(--color-text-disabled)]">sec</span>
                    </div>
                </div>
                <div v-if="settings.auto_heating_on != null" class="flex items-center justify-between text-sm">
                    <span class="text-[var(--color-text-disabled)]">Auto heating</span>
                    <button class="text-lg" :class="settings.auto_heating_on ? 'text-[var(--color-success-text)]' : 'text-[var(--color-text-disabled)]'"
                        @click="setConfig({auto_heating_on: !settings.auto_heating_on})">
                        <i class="fas" :class="settings.auto_heating_on ? 'fa-toggle-on' : 'fa-toggle-off'" />
                    </button>
                </div>
                <div v-if="settings.ui?.brightness != null" class="flex items-center justify-between text-sm">
                    <span class="text-[var(--color-text-disabled)]">UI brightness</span>
                    <input type="number" class="bg-[var(--color-surface-3)] border border-[var(--color-border-default)] rounded px-2 py-1 text-sm text-[var(--color-text-primary)] w-16 text-center"
                        :value="settings.ui.brightness" min="0" max="100"
                        @change="(e: Event) => setConfig({ui: {brightness: Number((e.target as HTMLInputElement).value)}})" />
                </div>
                <div v-if="settings.ui?.mode != null" class="flex items-center justify-between text-sm">
                    <span class="text-[var(--color-text-disabled)]">UI mode</span>
                    <select class="bg-[var(--color-surface-3)] border border-[var(--color-border-default)] rounded px-2 py-1 text-sm text-[var(--color-text-primary)]"
                        :value="settings.ui.mode"
                        @change="(e: Event) => setConfig({ui: {mode: (e.target as HTMLSelectElement).value}})">
                        <option value="off">Off</option>
                        <option value="level">Level</option>
                        <option value="intensity">Intensity</option>
                    </select>
                </div>
                <div v-if="settings.ambient" class="flex flex-col gap-1">
                    <span class="text-xs text-[var(--color-text-disabled)]">Ambient Light</span>
                    <div class="flex items-center justify-between text-sm">
                        <span class="text-[var(--color-text-disabled)]">Enable</span>
                        <button class="text-lg" :class="settings.ambient.enable ? 'text-[var(--color-success-text)]' : 'text-[var(--color-text-disabled)]'"
                            @click="setConfig({ambient: {enable: !settings.ambient.enable}})">
                            <i class="fas" :class="settings.ambient.enable ? 'fa-toggle-on' : 'fa-toggle-off'" />
                        </button>
                    </div>
                    <div class="flex items-center justify-between text-sm">
                        <span class="text-[var(--color-text-disabled)]">Use vial color</span>
                        <button class="text-lg" :class="settings.ambient.use_vial_color ? 'text-[var(--color-success-text)]' : 'text-[var(--color-text-disabled)]'"
                            @click="setConfig({ambient: {use_vial_color: !settings.ambient.use_vial_color}})">
                            <i class="fas" :class="settings.ambient.use_vial_color ? 'fa-toggle-on' : 'fa-toggle-off'" />
                        </button>
                    </div>
                    <div class="flex items-center justify-between text-sm">
                        <span class="text-[var(--color-text-disabled)]">Brightness</span>
                        <input type="number" class="bg-[var(--color-surface-3)] border border-[var(--color-border-default)] rounded px-2 py-1 text-sm text-[var(--color-text-primary)] w-16 text-center"
                            :value="settings.ambient.brightness" min="0" max="100"
                            @change="(e: Event) => setConfig({ambient: {brightness: Number((e.target as HTMLInputElement).value)}})" />
                    </div>
                </div>
                <!-- Initial state per slot -->
                <div v-if="settings.initial_state" class="flex flex-col gap-1">
                    <span class="text-xs text-[var(--color-text-disabled)]">Initial State</span>
                    <div v-for="slot in ['left', 'right']" :key="'init-' + slot" class="flex items-center justify-between text-sm">
                        <span class="text-[var(--color-text-disabled)]">{{ slot === 'left' ? 'Left' : 'Right' }}</span>
                        <select class="bg-[var(--color-surface-3)] border border-[var(--color-border-default)] rounded px-2 py-1 text-sm text-[var(--color-text-primary)]"
                            :value="settings.initial_state[slot]"
                            @change="(e: Event) => setConfig({initial_state: {[slot]: (e.target as HTMLSelectElement).value}})">
                            <option value="restore_last">Restore Last</option>
                            <option value="on">On</option>
                            <option value="off">Off</option>
                        </select>
                    </div>
                </div>
                <!-- Timers per slot -->
                <div v-if="settings.timer" class="flex flex-col gap-1">
                    <span class="text-xs text-[var(--color-text-disabled)]">Timers</span>
                    <div v-for="slot in ['left', 'right']" :key="'timer-' + slot" class="flex flex-col gap-1">
                        <span class="text-xs font-semibold text-[var(--color-text-secondary)]">{{ slot === 'left' ? 'Left' : 'Right' }}</span>
                        <div class="flex items-center gap-2 text-sm">
                            <button class="text-lg" :class="settings.timer[slot].auto_on ? 'text-[var(--color-success-text)]' : 'text-[var(--color-text-disabled)]'"
                                @click="setConfig({timer: {[slot]: {auto_on: !settings.timer[slot].auto_on}}})">
                                <i class="fas" :class="settings.timer[slot].auto_on ? 'fa-toggle-on' : 'fa-toggle-off'" />
                            </button>
                            <span class="text-[var(--color-text-disabled)]">Auto On</span>
                            <input v-if="settings.timer[slot].auto_on" type="number" class="bg-[var(--color-surface-3)] border border-[var(--color-border-default)] rounded px-2 py-1 text-sm text-[var(--color-text-primary)] w-16 text-center"
                                :value="settings.timer[slot].auto_on_delay" min="0" step="1"
                                @change="(e: Event) => setConfig({timer: {[slot]: {auto_on_delay: Number((e.target as HTMLInputElement).value)}}})" />
                            <span v-if="settings.timer[slot].auto_on" class="text-xs text-[var(--color-text-disabled)]">sec</span>
                        </div>
                        <div class="flex items-center gap-2 text-sm">
                            <button class="text-lg" :class="settings.timer[slot].auto_off ? 'text-[var(--color-success-text)]' : 'text-[var(--color-text-disabled)]'"
                                @click="setConfig({timer: {[slot]: {auto_off: !settings.timer[slot].auto_off}}})">
                                <i class="fas" :class="settings.timer[slot].auto_off ? 'fa-toggle-on' : 'fa-toggle-off'" />
                            </button>
                            <span class="text-[var(--color-text-disabled)]">Auto Off</span>
                            <input v-if="settings.timer[slot].auto_off" type="number" class="bg-[var(--color-surface-3)] border border-[var(--color-border-default)] rounded px-2 py-1 text-sm text-[var(--color-text-primary)] w-16 text-center"
                                :value="settings.timer[slot].auto_off_delay" min="0" step="1"
                                @change="(e: Event) => setConfig({timer: {[slot]: {auto_off_delay: Number((e.target as HTMLInputElement).value)}}})" />
                            <span v-if="settings.timer[slot].auto_off" class="text-xs text-[var(--color-text-disabled)]">sec</span>
                        </div>
                    </div>
                </div>
            </template>
        </div>

        <!-- Errors -->
        <div v-if="status?.errors?.length" class="p-3 bg-[var(--color-danger-subtle)] rounded-lg">
            <span class="text-sm text-[var(--color-danger-text)] font-semibold block mb-1">
                <i class="fas fa-triangle-exclamation mr-1"></i> Issues Detected
            </span>
            <span v-for="(err, i) in status?.errors" :key="i" class="text-xs text-[var(--color-danger-text)] block">
                {{ formatCuryError(err) }}
            </span>
        </div>

        <div v-if="configError" class="text-xs text-[var(--color-danger-text)]">
            <i class="fas fa-triangle-exclamation"></i> {{ configError }}
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from 'vue';
import {sendRPC} from '@/tools/websocket';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    shellyID?: string;
}>();

const PRESETS = [
    {label: 'Off', value: 0},
    {label: 'Low', value: 25},
    {label: 'Medium', value: 50},
    {label: 'High', value: 75},
    {label: 'Max', value: 100}
];

const emit = defineEmits<{
    'toggle-slot': [slot: string, on: boolean];
    'set-intensity': [slot: string, intensity: number];
    boost: [slot: string];
    'stop-boost': [slot: string];
    'set-ambient-color': [rgb: [number, number, number]];
    'toggle-away-mode': [enabled: boolean];
    'set-mode': [mode: string];
}>();

const configError = ref<string | null>(null);
const showSettings = ref(false);
const vialInfo = ref<Record<string, any> | null>(null);

async function setConfig(config: Record<string, any>) {
    if (!props.shellyID) return;
    configError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Cury.SetConfig', {
            shellyID: props.shellyID,
            id: props.status?.id ?? 0,
            config
        });
    } catch (e: any) {
        configError.value = e.message || 'Failed to set config';
    }
}

function setMode(mode: string) {
    configError.value = null;
    emit('set-mode', mode);
}

async function loadVialInfo() {
    if (!props.shellyID) return;
    try {
        const result = await sendRPC<Record<string, any>>(
            'FLEET_MANAGER',
            'Cury.GetVialInfo',
            {shellyID: props.shellyID, id: props.status?.id ?? 0}
        );
        vialInfo.value = result;
    } catch {
        // Ignore — vial info is supplementary
    }
}

onMounted(() => {
    if (props.shellyID) loadVialInfo();
});

function isSlotAvailable(slot: 'left' | 'right'): boolean {
    const vial = props.status?.slots?.[slot]?.vial;
    if (!vial) return false;
    if (!vial.serial || vial.serial === '0000000000000000') return false;
    // Vial inserted but has a fault — show controls but indicate fault
    return true;
}

function getVialFault(slot: 'left' | 'right'): string | null {
    const fault = props.status?.slots?.[slot]?.vial?.vial_fault;
    if (!fault) return null;
    const labels: Record<string, string> = {
        non_genuine: 'Non-genuine vial',
        tag_error: 'Tag read error',
        expired: 'Vial expired',
        empty: 'Vial empty'
    };
    return labels[fault] ?? fault;
}

const ambientColor = computed((): [number, number, number] => {
    const color = props.settings?.ambient?.color;
    if (Array.isArray(color) && color.length === 3) {
        return color as [number, number, number];
    }
    return [255, 255, 255];
});

function formatVialLevel(
    vial: {level?: number; serial?: string} | undefined | null
): string {
    if (!vial) return 'N/A';
    if (!vial.serial || vial.serial === '0000000000000000')
        return 'Not inserted';
    const level = vial.level;
    if (level === undefined || level === null) return 'N/A';
    if (level < 0) return 'Reading...';
    return `${level}%`;
}

function boostRemaining(boost: {started_at: number; duration: number}): string {
    const elapsed = Math.max(
        0,
        Math.floor(Date.now() / 1000) - boost.started_at
    );
    const remaining = Math.max(0, boost.duration - elapsed);
    return formatDuration(remaining);
}

function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
}

function formatCuryError(error: string): string {
    const errorMessages: Record<string, string> = {
        nfc_bus: 'NFC bus error',
        acc_bus: 'Accelerometer bus error',
        keyboard_button_stuck: 'Button stuck',
        keyboard_general_error: 'Keyboard error',
        input_voltage_out_of_range: 'Input voltage out of range',
        thermal_sensor_connection: 'Thermal sensor disconnected',
        thermal_sensor_driver: 'Thermal sensor driver error',
        heater_disconnected: 'Heater disconnected',
        heater_overload: 'Heater overload',
        input_voltage_change: 'Input voltage changed',
        orientation_tilt: 'Device is tilted',
        orientation_plug_rotated: 'Plug rotated'
    };
    return errorMessages[error] || error.replace(/_/g, ' ');
}
</script>

<style scoped>
.et-cury__presets {
    display: flex;
    gap: var(--space-1);
}
.et-cury__preset {
    flex: 1;
    padding: var(--space-1) 0;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-3);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    cursor: pointer;
    text-align: center;
}
.et-cury__preset:hover:not(:disabled) {
    background: var(--color-surface-4);
    color: var(--color-text-primary);
}
.et-cury__preset--act {
    background: var(--color-primary-subtle);
    border-color: var(--color-primary);
    color: var(--color-primary);
}
.et-cury__preset:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.et-cury__slot-actions {
    display: flex;
    gap: var(--space-1);
}
.et-cury__action-btn {
    flex: 1;
    padding: var(--space-1-5) 0;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
}
.et-cury__action-btn:hover:not(:disabled) {
    background: var(--color-surface-3);
    color: var(--color-text-primary);
}
.et-cury__action-btn--stop {
    border-color: var(--color-danger);
    color: var(--color-danger-text);
}
.et-cury__action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.et-cury__boost-info {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-warning-text);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-status-warn) 10%, transparent);
}
.et-cury__vial-info {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-body);
}
.et-cury__status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--color-text-disabled);
    flex-shrink: 0;
}
.et-cury__status-dot--on {
    background: var(--color-success);
    box-shadow: 0 0 6px rgba(var(--color-success-rgb), 0.5);
}
.et-cury__vial-color {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1px solid var(--color-border-strong);
    flex-shrink: 0;
}
</style>

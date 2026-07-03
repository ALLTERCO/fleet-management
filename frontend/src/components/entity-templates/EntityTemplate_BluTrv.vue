<template>
    <div class="et-trv">
        <!-- Name (editable with save button) -->
        <div v-if="canExecute" class="et-trv__name-row">
            <input
                v-model="editName"
                class="et-trv__name-input"
                placeholder="TRV name (e.g. Living Room)"
            />
            <button class="et-trv__btn" :disabled="editName === (settings?.name ?? '')" @click="renameTrv(editName)">
                <i class="fas fa-save" /> Save
            </button>
            <span class="et-trv__addr">{{ settings?.addr ?? '' }}</span>
        </div>

        <!-- Current / Target temps -->
        <div class="et-trv__temps">
            <div class="et-trv__temp-card">
                <span class="et-trv__temp-value">{{ currentDisplay }}</span>
                <span class="et-trv__temp-label">Current</span>
            </div>
            <div class="et-trv__temp-card et-trv__temp-card--target">
                <span class="et-trv__temp-value">{{ optimisticTargetDisplay }}</span>
                <span class="et-trv__temp-label">Target</span>
            </div>
        </div>

        <!-- Valve position bar + control -->
        <div class="et-trv__valve">
            <div class="et-trv__valve-label">Valve {{ valvePos }}%</div>
            <div class="et-trv__valve-bar">
                <div class="et-trv__valve-fill" :style="{ width: valvePos + '%' }"></div>
            </div>
            <div v-if="canExecute && !trvEnable" class="et-trv__valve-control">
                <HorizontalSlider :value="valvePos" :min="0" :max="100" :step="1" @change="(v: number) => callTrv('TRV.SetPosition', { id: 0, pos: v }, false)">
                    <template #title>Set Valve {{ valvePos }}%</template>
                </HorizontalSlider>
            </div>
        </div>

        <!-- Errors -->
        <div v-if="errors.length" class="et-trv__errors">
            <div v-for="err in errors" :key="err" class="et-trv__error-badge">
                <i class="fas fa-triangle-exclamation" /> {{ formatError(err) }}
            </div>
        </div>

        <!-- Updating firmware notice -->
        <div v-if="updating" class="et-trv__mode-info">
            <i class="fas fa-spinner fa-spin" style="color:var(--color-primary)" /> Firmware updating... TRV will be unresponsive for a few minutes.
        </div>

        <!-- Target temp slider (optimistic) -->
        <div v-if="canExecute" class="et-trv__section">
            <HorizontalSlider
                :value="optimisticTarget"
                :min="5" :max="30" :step="0.5"
                :saved="{ '16°': 16, '18°': 18, '20°': 20, '22°': 22, '24°': 24 }"
                @change="setTargetOptimistic"
            >
                <template #title>Target {{ optimisticTarget }}°C</template>
            </HorizontalSlider>
        </div>

        <!-- Quick actions: Boost -->
        <div v-if="canExecute" class="et-trv__section">
            <div class="et-trv__section-header"><i class="fas fa-fire" /> Boost</div>
            <div class="et-trv__row">
                <span class="et-trv__row-label">Duration</span>
                <select class="et-trv__select" v-model.number="boostDuration">
                    <option :value="300">5 min</option>
                    <option :value="900">15 min</option>
                    <option :value="1800">30 min</option>
                    <option :value="3600">1 hour</option>
                    <option :value="7200">2 hours</option>
                </select>
                <button class="et-trv__btn" :disabled="busy" @click="startBoost">
                    <i class="fas fa-fire" /> Start
                </button>
                <button v-if="hasBoost" class="et-trv__btn et-trv__btn--warn" :disabled="busy" @click="clearBoost">
                    <i class="fas fa-xmark" /> Stop
                </button>
            </div>
            <div v-if="hasBoost" class="et-trv__mode-info">
                <i class="fas fa-fire" style="color:var(--color-danger-text)" /> Boost active — {{ boostRemaining }}
            </div>
        </div>

        <!-- Quick actions: Override -->
        <div v-if="canExecute" class="et-trv__section">
            <div class="et-trv__section-header"><i class="fas fa-clock" /> Override</div>
            <div class="et-trv__row">
                <span class="et-trv__row-label">Temp</span>
                <input type="number" class="et-trv__input" v-model.number="overrideTemp" min="5" max="30" step="0.5" style="width:56px" />
                <span class="et-trv__row-label" style="flex:0">for</span>
                <select class="et-trv__select" v-model.number="overrideDuration">
                    <option :value="900">15 min</option>
                    <option :value="1800">30 min</option>
                    <option :value="3600">1 hour</option>
                    <option :value="7200">2 hours</option>
                    <option :value="14400">4 hours</option>
                    <option :value="86400">24 hours</option>
                </select>
                <button class="et-trv__btn" :disabled="busy" @click="callTrv('TRV.SetOverride', { id: 0, target_C: overrideTemp, duration: overrideDuration }, true)">
                    <i class="fas fa-clock" /> Set
                </button>
                <button v-if="hasOverride" class="et-trv__btn et-trv__btn--warn" :disabled="busy" @click="callTrv('TRV.ClearOverride', { id: 0 }, true)">
                    <i class="fas fa-xmark" /> Stop
                </button>
            </div>
            <div v-if="hasOverride" class="et-trv__mode-info">
                <i class="fas fa-clock" style="color:var(--color-warning-text)" /> Override {{ overrideTarget }}°C — {{ overrideRemaining }}
            </div>
        </div>

        <!-- Actions row -->
        <div v-if="canExecute" class="et-trv__actions">
            <button class="et-trv__btn" :disabled="busy" @click="callTrv('TRV.Calibrate', { id: 0 }, false)"><i class="fas fa-crosshairs" /> Calibrate</button>
            <button class="et-trv__btn" :disabled="busy" @click="callTrv('Shelly.Reboot', {}, false)"><i class="fas fa-rotate" /> Reboot TRV</button>
            <button class="et-trv__btn et-trv__btn--danger" :disabled="busy" @click="factoryReset"><i class="fas fa-bomb" /> Factory Reset</button>
            <button class="et-trv__btn et-trv__btn--danger" :disabled="busy" @click="deleteTrv">Unpair TRV</button>
        </div>

        <!-- External Temperature -->
        <div v-if="canExecute" class="et-trv__section">
            <div class="et-trv__section-header"><i class="fas fa-thermometer-half" /> External Temperature</div>
            <div class="et-trv__row">
                <input type="number" class="et-trv__input" v-model.number="extTemp" step="0.5" placeholder="°C" style="width:70px" />
                <button class="et-trv__btn" :disabled="busy" @click="callTrv('TRV.SetExternalTemperature', { id: 0, t_C: extTemp }, false)"><i class="fas fa-paper-plane" /> Send</button>
                <button class="et-trv__btn" :disabled="busy" @click="callTrv('TRV.SetExternalTemperature', { id: 0, t_C: null }, false)"><i class="fas fa-xmark" /> Revert</button>
            </div>
        </div>

        <!-- TRV Config -->
        <div v-if="canExecute && remoteLoaded" class="et-trv__section">
            <div class="et-trv__section-header"><i class="fas fa-gear" /> Settings</div>
            <div class="et-trv__row">
                <span class="et-trv__row-label">Thermostat</span>
                <button class="et-trv__toggle" :class="trvEnable && 'et-trv__toggle--on'" @click="setTrvConfig({ enable: !trvEnable })">{{ trvEnable ? 'ON' : 'OFF' }}</button>
            </div>
            <div class="et-trv__row">
                <span class="et-trv__row-label">Override Enable</span>
                <button class="et-trv__toggle" :class="overrideEnable && 'et-trv__toggle--on'" @click="setTrvConfig({ override_enable: !overrideEnable })">{{ overrideEnable ? 'ON' : 'OFF' }}</button>
            </div>
            <div class="et-trv__row">
                <span class="et-trv__row-label">Min Valve Position</span>
                <input type="number" class="et-trv__input" :value="minValve" min="0" max="100" @change="(e: Event) => setTrvConfig({ min_valve_position: Number((e.target as HTMLInputElement).value) })" />
            </div>
            <div class="et-trv__row">
                <span class="et-trv__row-label">Temp Offset</span>
                <input type="number" class="et-trv__input" :value="tempOffset" step="0.5" min="-10" max="10" @change="(e: Event) => callTrv('Temperature.SetConfig', { id: 0, config: { offset_C: Number((e.target as HTMLInputElement).value) } }, true)" />
            </div>
            <div class="et-trv__row">
                <span class="et-trv__row-label">Override Delay</span>
                <input type="number" class="et-trv__input" :value="settings?.override_delay ?? 30" min="0" max="300" @change="(e: Event) => setGatewayConfig({ override_delay: Number((e.target as HTMLInputElement).value) })" />
                <span class="et-trv__row-value">s</span>
            </div>
        </div>

        <!-- Associations -->
        <div v-if="canExecute && remoteLoaded" class="et-trv__section">
            <div class="et-trv__section-header"><i class="fas fa-link" /> Associations</div>
            <div class="et-trv__row">
                <span class="et-trv__row-label">Temp Sensors</span>
                <span class="et-trv__row-value">{{ (settings?.temp_sensors ?? []).length ? (settings?.temp_sensors as string[]).join(', ') : 'None' }}</span>
            </div>
            <div class="et-trv__row">
                <span class="et-trv__row-label">Door/Window Sensors</span>
                <span class="et-trv__row-value">{{ (settings?.dw_sensors ?? []).length ? (settings?.dw_sensors as string[]).join(', ') : 'None' }}</span>
            </div>
            <div class="et-trv__empty-hint">Pair BLU H&T or Door/Window sensors via the gateway's pairing button</div>
        </div>

        <!-- Flags -->
        <div v-if="canExecute && remoteLoaded" class="et-trv__section">
            <div class="et-trv__section-header"><i class="fas fa-flag" /> Flags</div>
            <div v-for="flag in ALL_FLAGS" :key="flag.key" class="et-trv__row">
                <span class="et-trv__row-label">{{ flag.label }}</span>
                <button class="et-trv__toggle" :class="activeFlags.has(flag.key) && 'et-trv__toggle--on'" @click="toggleFlag(flag.key)">{{ activeFlags.has(flag.key) ? 'ON' : 'OFF' }}</button>
            </div>
        </div>

        <!-- Schedule -->
        <div v-if="canExecute" class="et-trv__section">
            <div class="et-trv__section-header">
                <i class="fas fa-calendar" /> Schedule
                <button class="et-trv__btn-sm" :disabled="busy" @click="loadSchedule"><i :class="loadingSchedule ? 'fas fa-spinner fa-spin' : 'fas fa-rotate'" /></button>
            </div>
            <template v-if="scheduleLoaded">
                <div v-for="rule in scheduleRules" :key="rule.rule_id" class="et-trv__sched-rule">
                    <div class="et-trv__sched-row">
                        <input type="time" class="et-trv__input" :value="cronToTime(rule.timespec)" @change="(e: Event) => updateRule(rule.rule_id, { timespec: timeToCron((e.target as HTMLInputElement).value, cronToDays(rule.timespec)), target_C: rule.target_C, enable: rule.enable })" />
                        <input type="number" class="et-trv__input" style="width:50px" :value="rule.target_C" min="5" max="30" step="0.5" @change="(e: Event) => updateRule(rule.rule_id, { timespec: rule.timespec, target_C: Number((e.target as HTMLInputElement).value), enable: rule.enable })" />
                        <span class="et-trv__row-value">°C</span>
                        <button class="et-trv__rule-del" @click="removeRule(rule.rule_id)"><i class="fas fa-xmark" /></button>
                    </div>
                    <div class="et-trv__sched-days">
                        <button v-for="d in DAY_OPTIONS" :key="d.value" class="et-trv__day-btn" :class="cronHasDay(rule.timespec, d.value) && 'et-trv__day-btn--on'" @click="toggleRuleDay(rule, d.value)">{{ d.label }}</button>
                    </div>
                </div>
                <div v-if="!scheduleRules.length" class="et-trv__empty-hint">No schedule rules</div>
                <div class="et-trv__sched-add">
                    <div class="et-trv__section-header" style="font-size:var(--type-body)">Add Rule</div>
                    <div class="et-trv__sched-row">
                        <input type="time" class="et-trv__input" v-model="newRuleTime" />
                        <input type="number" class="et-trv__input" style="width:50px" v-model.number="newRuleTemp" min="5" max="30" step="0.5" />
                        <span class="et-trv__row-value">°C</span>
                        <button class="et-trv__btn-sm" @click="addRule"><i class="fas fa-plus" /></button>
                    </div>
                    <div class="et-trv__sched-days">
                        <button v-for="d in DAY_OPTIONS" :key="d.value" class="et-trv__day-btn" :class="newRuleDays.has(d.value) && 'et-trv__day-btn--on'" @click="toggleNewDay(d.value)">{{ d.label }}</button>
                    </div>
                </div>
            </template>
            <div v-else class="et-trv__empty-hint">Click refresh to load schedule rules</div>
        </div>

        <!-- Display settings -->
        <div v-if="canExecute && remoteLoaded" class="et-trv__section">
            <div class="et-trv__section-header"><i class="fas fa-display" /> Display</div>
            <div class="et-trv__row">
                <span class="et-trv__row-label">Child Lock</span>
                <button class="et-trv__toggle" :class="uiLock && 'et-trv__toggle--on'" @click="setSysConfig({ ui: { lock: !uiLock } })">{{ uiLock ? 'ON' : 'OFF' }}</button>
            </div>
            <div class="et-trv__row">
                <span class="et-trv__row-label">Unit</span>
                <button class="et-trv__toggle" :class="useF && 'et-trv__toggle--on'" @click="setSysConfig({ ui: { t_units: useF ? 'C' : 'F' } })">{{ useF ? '°F' : '°C' }}</button>
            </div>
            <div class="et-trv__row">
                <span class="et-trv__row-label">Flip Display</span>
                <button class="et-trv__toggle" :class="uiFlip && 'et-trv__toggle--on'" @click="setSysConfig({ ui: { flip: !uiFlip } })">{{ uiFlip ? 'ON' : 'OFF' }}</button>
            </div>
            <div class="et-trv__row">
                <span class="et-trv__row-label">Brightness</span>
                <input type="range" class="et-trv__range" :value="uiBrightness" min="1" max="7" @change="(e: Event) => setSysConfig({ ui: { brightness: Number((e.target as HTMLInputElement).value) } })" />
                <span class="et-trv__row-value">{{ uiBrightness }}</span>
            </div>
            <div class="et-trv__row">
                <span class="et-trv__row-label">Message</span>
                <input v-model="displayMsg" class="et-trv__input" maxlength="10" placeholder="max 10 chars" style="flex:1" />
                <button class="et-trv__btn-sm" :disabled="!displayMsg" @click="showMessage"><i class="fas fa-paper-plane" /></button>
            </div>
        </div>

        <!-- Time Sync -->
        <div v-if="canExecute && remoteLoaded" class="et-trv__section">
            <div class="et-trv__section-header"><i class="fas fa-clock" /> Time</div>
            <div class="et-trv__row">
                <span class="et-trv__row-label">Sync TRV clock to now</span>
                <button class="et-trv__btn" :disabled="busy" @click="syncTime"><i class="fas fa-clock" /> Sync</button>
            </div>
        </div>

        <!-- Remote config load button (if not loaded yet) -->
        <div v-if="canExecute && !remoteLoaded" class="et-trv__section">
            <button class="et-trv__btn" :disabled="busy" @click="refreshRemote">
                <i :class="busy ? 'fas fa-spinner fa-spin' : 'fas fa-gear'" /> Load TRV Settings
            </button>
        </div>

        <!-- Device info -->
        <div class="et-trv__info">
            <div class="et-trv__info-item"><i class="fas fa-battery-three-quarters" /> {{ batteryDisplay }}</div>
            <div class="et-trv__info-item"><i class="fas fa-signal" /> {{ rssiDisplay }}</div>
            <div class="et-trv__info-item"><i class="fas fa-link" /> {{ connectedDisplay }}</div>
            <div class="et-trv__info-item"><i class="fas fa-code-branch" /> {{ fwDisplay }}</div>
            <div v-if="hasUpdate && !updating" class="et-trv__info-item et-trv__info-item--update">
                <i class="fas fa-download" /> Update available
                <button v-if="canExecute" class="et-trv__btn-sm" :disabled="busy" @click="updateFirmware"><i class="fas fa-download" /></button>
            </div>
        </div>

        <div v-if="trvError" class="et-trv__error-msg">
            <i class="fas fa-triangle-exclamation" /> {{ trvError }}
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue';
import HorizontalSlider from '@/components/core/HorizontalSlider.vue';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {sendRPC} from '@/tools/websocket';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    shellyID?: string;
    entityId?: string;
}>();

const deviceStore = useDevicesStore();
const entityStore = useEntityStore();
const busy = ref(false);
const trvError = ref<string | null>(null);
const loadingSchedule = ref(false);
const scheduleLoaded = ref(false);
const scheduleRules = ref<Array<Record<string, any>>>([]);
const newRuleTime = ref('08:00');
const newRuleTemp = ref(22);
const newRuleDays = ref(new Set([1, 2, 3, 4, 5]));
const editName = ref(props.settings?.name ?? '');
const displayMsg = ref('');
const overrideTemp = ref(25);
const overrideDuration = ref(3600);
const boostDuration = ref(1800);
const remoteConfig = ref<Record<string, any> | null>(null);
const remoteStatus = ref<Record<string, any> | null>(null);
const remoteLoaded = ref(false);
const updateAvailable = ref<string | null>(null);
const updating = ref(false);
const tempOffset = ref(0);
const extTemp = ref(22);

// Optimistic target temp — updates immediately on user input
const localTarget = ref<number | null>(null);
const optimisticTarget = computed(
    () => localTarget.value ?? props.status?.target_C ?? 10
);
const optimisticTargetDisplay = computed(
    () => `${Number(optimisticTarget.value).toFixed(1)}°C`
);

// Reset optimistic when real status catches up
watch(
    () => props.status?.target_C,
    (newVal) => {
        if (newVal != null && localTarget.value != null) {
            if (Math.abs(newVal - localTarget.value) < 0.1)
                localTarget.value = null;
        }
    }
);

function setTargetOptimistic(v: number) {
    localTarget.value = v;
    callTrv('TRV.SetTarget', {id: 0, target_C: v}, false);
}

// Status
const targetTemp = computed(() => props.status?.target_C ?? 10);
const currentTemp = computed(() => props.status?.current_C ?? 0);
const valvePos = computed(() => props.status?.pos ?? 0);
const errors = computed(() => props.status?.errors ?? []);
const battery = computed(() => props.status?.battery);
const rssi = computed(() => props.status?.rssi);
const connected = computed(() => props.status?.connected ?? false);
const fwVer = computed(() => props.status?.fw_ver ?? '—');

const currentDisplay = computed(() =>
    currentTemp.value != null
        ? `${Number(currentTemp.value).toFixed(1)}°C`
        : 'N/A'
);
const batteryDisplay = computed(() =>
    battery.value != null ? `${battery.value}%` : '—'
);
const rssiDisplay = computed(() =>
    rssi.value != null ? `${rssi.value} dBm` : '—'
);
const connectedDisplay = computed(() =>
    connected.value ? 'Connected' : 'Disconnected'
);
const fwDisplay = computed(() => fwVer.value);
const hasUpdate = computed(() => !!updateAvailable.value);

// Remote status fields
const trvStatus = computed(() => remoteStatus.value?.status?.['trv:0'] ?? {});
const hasBoost = computed(() => !!trvStatus.value?.boost);
const hasOverride = computed(() => !!trvStatus.value?.override);
const overrideTarget = computed(() =>
    hasOverride.value ? trvStatus.value.target_C : null
);

function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${(seconds / 3600).toFixed(1)}h`;
}

const boostRemaining = computed(() => {
    const b = trvStatus.value?.boost;
    if (!b) return '—';
    const elapsed = Math.max(0, Date.now() / 1000 - b.started_at);
    return formatDuration(Math.max(0, b.duration - elapsed));
});

const overrideRemaining = computed(() => {
    const o = trvStatus.value?.override;
    if (!o) return '—';
    const elapsed = Math.max(0, Date.now() / 1000 - o.started_at);
    return formatDuration(Math.max(0, o.duration - elapsed));
});

// Remote config fields
const trvConfig = computed(() => remoteConfig.value?.config?.['trv:0'] ?? {});
const trvEnable = computed(() => trvConfig.value?.enable ?? true);
const overrideEnable = computed(() => trvConfig.value?.override_enable ?? true);
const minValve = computed(() => trvConfig.value?.min_valve_position ?? 0);
const activeFlags = computed(() => new Set(trvConfig.value?.flags ?? []));

const sysConfig = computed(() => remoteConfig.value?.config?.sys ?? {});
const uiLock = computed(() => sysConfig.value?.ui?.lock ?? false);
const useF = computed(() => sysConfig.value?.ui?.t_units === 'F');
const uiFlip = computed(() => sysConfig.value?.ui?.flip ?? false);
const uiBrightness = computed(() => sysConfig.value?.ui?.brightness ?? 7);

const ALL_FLAGS = [
    {key: 'silent_mode', label: 'Silent Mode'},
    {key: 'auto_calibrate', label: 'Auto Calibrate'},
    {key: 'anticlog', label: 'Anti-Clog'},
    {key: 'floor_heating', label: 'Floor Heating'},
    {key: 'accel', label: 'Accelerated Heating'},
    {key: 'power_save', label: 'Power Save'}
];

const ERROR_MAP: Record<string, string> = {
    not_calibrated: 'Not Calibrated',
    not_mounted: 'Not Mounted',
    battery_low: 'Battery Low',
    ext_temp_missing: 'External Temp Missing'
};
function formatError(err: string): string {
    return ERROR_MAP[err] ?? err;
}

// Schedule helpers — convert between friendly UI and cron format
const DAY_OPTIONS = [
    {value: 1, label: 'Mon'},
    {value: 2, label: 'Tue'},
    {value: 3, label: 'Wed'},
    {value: 4, label: 'Thu'},
    {value: 5, label: 'Fri'},
    {value: 6, label: 'Sat'},
    {value: 0, label: 'Sun'}
];

function cronToTime(cron: string): string {
    const parts = cron.split(' ');
    if (parts.length < 3) return '08:00';
    return `${parts[2].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
}

function cronToDays(cron: string): number[] {
    const parts = cron.split(' ');
    if (parts.length < 6 || parts[5] === '*') return [0, 1, 2, 3, 4, 5, 6];
    return parts[5].split(',').map(Number);
}

function cronHasDay(cron: string, day: number): boolean {
    return cronToDays(cron).includes(day);
}

function timeToCron(time: string, days: number[]): string {
    const [h, m] = time.split(':').map(Number);
    const dayStr = days.length === 7 ? '*' : days.join(',');
    return `0 ${m} ${h} * * ${dayStr}`;
}

function toggleNewDay(day: number) {
    const s = new Set(newRuleDays.value);
    if (s.has(day)) s.delete(day);
    else s.add(day);
    newRuleDays.value = s;
}

function toggleRuleDay(rule: Record<string, any>, day: number) {
    const days = cronToDays(rule.timespec);
    const idx = days.indexOf(day);
    if (idx >= 0) days.splice(idx, 1);
    else days.push(day);
    days.sort();
    const time = cronToTime(rule.timespec);
    updateRule(rule.rule_id, {
        timespec: timeToCron(time, days),
        target_C: rule.target_C,
        enable: rule.enable
    });
}

// RPC helpers
function getTrvId(): number {
    return props.status?.id ?? props.settings?.id ?? 200;
}

async function callTrv(
    method: string,
    params: Record<string, any>,
    refresh = false
) {
    if (!props.shellyID) return;
    trvError.value = null;
    busy.value = true;
    try {
        await sendRPC('FLEET_MANAGER', 'Trv.Call', {
            shellyID: props.shellyID,
            id: getTrvId(),
            method,
            params
        });
        if (refresh && remoteLoaded.value) await refreshRemote();
    } catch (e: any) {
        trvError.value = e.message || `${method} failed`;
    }
    busy.value = false;
}

async function invokeTrvAction(
    action: string,
    params?: Record<string, any>,
    refresh = false
) {
    if (!props.entityId) return;
    trvError.value = null;
    busy.value = true;
    try {
        await entityStore.invokeAction(props.entityId, action, params);
        if (refresh && remoteLoaded.value) await refreshRemote();
    } catch (e: any) {
        trvError.value = e.message || `${action} failed`;
    }
    busy.value = false;
}

function startBoost() {
    invokeTrvAction('startBoost', {duration: boostDuration.value}, true);
}

function clearBoost() {
    invokeTrvAction('clearBoost', undefined, true);
}

async function renameTrv(name: string) {
    if (!props.shellyID) return;
    trvError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Trv.SetConfig', {
            shellyID: props.shellyID,
            id: getTrvId(),
            config: {name: name || null}
        });
    } catch (e: any) {
        trvError.value = e.message || 'Rename failed';
    }
}

async function setTrvConfig(config: Record<string, any>) {
    await callTrv('Trv.SetConfig', {id: 0, config}, true);
}
async function setSysConfig(config: Record<string, any>) {
    await callTrv('Sys.SetConfig', {config}, true);
}

async function setGatewayConfig(config: Record<string, any>) {
    if (!props.shellyID) return;
    trvError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Trv.SetConfig', {
            shellyID: props.shellyID,
            id: getTrvId(),
            config
        });
    } catch (e: any) {
        trvError.value = e.message || 'Config failed';
    }
}

async function refreshRemote() {
    if (!props.shellyID) return;
    busy.value = true;
    try {
        const [rc, rs] = await Promise.all([
            sendRPC<any>('FLEET_MANAGER', 'Trv.GetRemoteConfig', {
                shellyID: props.shellyID,
                id: getTrvId()
            }),
            sendRPC<any>('FLEET_MANAGER', 'Trv.GetRemoteStatus', {
                shellyID: props.shellyID,
                id: getTrvId()
            })
        ]);
        remoteConfig.value = rc;
        remoteStatus.value = rs;
        remoteLoaded.value = true;
        tempOffset.value = rc?.config?.['temperature:0']?.offset_C ?? 0;
    } catch (e: any) {
        trvError.value = e.message || 'Failed to load remote config';
    }
    busy.value = false;
}

async function toggleFlag(flag: string) {
    const method = activeFlags.value.has(flag)
        ? 'TRV.ClearFlag'
        : 'TRV.SetFlag';
    await callTrv(method, {id: 0, flag}, true);
}

async function loadSchedule() {
    if (!props.shellyID) return;
    loadingSchedule.value = true;
    trvError.value = null;
    try {
        const result = await sendRPC<{rules: Array<Record<string, any>>}>(
            'FLEET_MANAGER',
            'Trv.Schedule.List',
            {shellyID: props.shellyID, id: getTrvId()}
        );
        scheduleRules.value = result?.rules ?? [];
        scheduleLoaded.value = true;
    } catch (e: any) {
        trvError.value = e.message || 'Failed to load schedule';
    }
    loadingSchedule.value = false;
}

async function callTrvSchedule(method: string, params: Record<string, any>) {
    if (!props.shellyID) return;
    trvError.value = null;
    busy.value = true;
    try {
        await sendRPC('FLEET_MANAGER', method, {
            shellyID: props.shellyID,
            id: getTrvId(),
            ...params
        });
    } catch (e: any) {
        trvError.value = e.message || `${method} failed`;
    }
    busy.value = false;
}

async function addRule() {
    const [hour, minute] = newRuleTime.value.split(':').map(Number);
    const days = Array.from(newRuleDays.value).sort();
    await callTrvSchedule('Trv.Schedule.Add', {
        hour,
        minute,
        days: days.length === 7 ? undefined : days,
        target_C: newRuleTemp.value,
        enable: true
    });
    await loadSchedule();
}

async function updateRule(ruleId: number, rule: Record<string, any>) {
    const patch: Record<string, any> = {ruleId};
    if (typeof rule.enable === 'boolean') patch.enable = rule.enable;
    if (typeof rule.target_C === 'number') patch.target_C = rule.target_C;
    if (typeof rule.timespec === 'string') {
        const [h, m] = cronToTime(rule.timespec).split(':').map(Number);
        patch.hour = h;
        patch.minute = m;
        const days = cronToDays(rule.timespec);
        patch.days = days.length === 7 ? undefined : days;
    }
    await callTrvSchedule('Trv.Schedule.Update', patch);
    await loadSchedule();
}

async function removeRule(ruleId: number) {
    await callTrvSchedule('Trv.Schedule.Remove', {ruleId});
    await loadSchedule();
}

function showMessage() {
    callTrv('TRV.ShowMessage', {id: 0, message: displayMsg.value}, false);
    displayMsg.value = '';
}

async function syncTime() {
    const now = Math.floor(Date.now() / 1000);
    const offset = -new Date().getTimezoneOffset() * 60;
    await callTrv('Sys.SetTime', {unixtime: now, offset}, false);
}

async function deleteTrv() {
    if (
        !props.shellyID ||
        !confirm('Unpair this TRV? It will be removed from the gateway.')
    )
        return;
    trvError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Trv.Delete', {
            shellyID: props.shellyID,
            id: getTrvId()
        });
    } catch (e: any) {
        trvError.value = e.message || 'Delete failed';
    }
}

async function factoryReset() {
    if (
        !confirm(
            'Factory reset the TRV? This will erase all settings on the valve itself.'
        )
    )
        return;
    if (!confirm('Are you absolutely sure? This cannot be undone.')) return;
    await callTrv('Shelly.FactoryReset', {}, false);
}

async function updateFirmware() {
    if (
        !props.shellyID ||
        !confirm(
            'Update TRV firmware? The TRV will be unresponsive for a few minutes.'
        )
    )
        return;
    trvError.value = null;
    updating.value = true;
    try {
        await sendRPC('FLEET_MANAGER', 'Trv.UpdateFirmware', {
            shellyID: props.shellyID,
            id: getTrvId()
        });
    } catch (e: any) {
        trvError.value = e.message || 'Update failed';
    }
    updating.value = false;
}

onMounted(async () => {
    if (!props.shellyID) return;
    try {
        const result = await sendRPC<any>(
            'FLEET_MANAGER',
            'Trv.CheckForUpdates',
            {shellyID: props.shellyID, id: getTrvId()}
        );
        if (result?.fw_id && result.fw_id !== props.status?.fw_ver)
            updateAvailable.value = result.fw_id;
    } catch {
        /* non-critical */
    }
});
</script>

<style scoped>
.et-trv { display: flex; flex-direction: column; gap: 0.625rem; }
.et-trv__name-row { display: flex; align-items: center; gap: var(--space-2); }
.et-trv__name-input { flex: 1; padding: var(--space-1-5) var(--space-2); border-radius: var(--radius-sm); border: 1px solid var(--color-border-default); background: var(--color-surface-2); color: var(--color-text-primary); font-size: var(--type-body); font-weight: var(--font-medium); }
.et-trv__addr { font-size: var(--type-body); color: var(--color-text-disabled); font-family: monospace; }
.et-trv__temps { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); }
.et-trv__temp-card { display: flex; flex-direction: column; align-items: center; padding: var(--space-3); border-radius: var(--radius-md); background-color: var(--color-surface-2); }
.et-trv__temp-card--target { background-color: var(--color-primary-subtle); }
.et-trv__temp-value { font-size: var(--type-subheading); font-weight: var(--font-bold); color: var(--color-text-primary); }
.et-trv__temp-label { font-size: var(--type-body); color: var(--color-text-disabled); }
.et-trv__valve { display: flex; flex-direction: column; gap: var(--space-1); }
.et-trv__valve-label { font-size: var(--type-body); font-weight: var(--font-semibold); color: var(--color-text-tertiary); }
.et-trv__valve-bar { height: 6px; border-radius: var(--radius-xs); background: var(--color-surface-3); overflow: hidden; }
.et-trv__valve-fill { height: 100%; border-radius: var(--radius-xs); background: linear-gradient(90deg, var(--color-warning), var(--color-danger-text)); transition: width 0.3s; }
.et-trv__valve-control { padding-top: var(--space-1); }
.et-trv__errors { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.et-trv__error-badge { display: flex; align-items: center; gap: var(--space-1); padding: var(--space-0-5) var(--space-2); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--color-danger) 15%, transparent); color: var(--color-danger-text); font-size: var(--type-body); font-weight: var(--font-semibold); }
.et-trv__actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.et-trv__btn { display: flex; align-items: center; gap: var(--space-1); padding: var(--space-1-5) var(--space-3); border-radius: var(--radius-md); border: 1px solid var(--color-border-default); background: var(--color-surface-2); color: var(--color-text-tertiary); font-size: var(--type-body); font-weight: var(--font-semibold); cursor: pointer; }
.et-trv__btn:hover:not(:disabled) { background: var(--color-surface-3); color: var(--color-text-primary); }
.et-trv__btn:disabled { opacity: 0.5; cursor: not-allowed; }
.et-trv__btn--warn { border-color: var(--color-danger); color: var(--color-danger-text); }
.et-trv__btn--danger { border-color: var(--color-danger); color: var(--color-danger-text); }
.et-trv__btn--danger:hover:not(:disabled) { background: color-mix(in srgb, var(--color-danger) 10%, transparent); }
.et-trv__btn-sm { background: none; border: none; color: var(--color-text-disabled); cursor: pointer; font-size: var(--type-body); padding: var(--space-0-5) var(--space-1-5); }
.et-trv__btn-sm:hover { color: var(--color-text-primary); }
.et-trv__mode-info { display: flex; align-items: center; gap: var(--space-2); font-size: var(--type-body); font-weight: var(--font-semibold); color: var(--color-text-secondary); padding: var(--space-2); border-radius: var(--radius-sm); background: var(--color-surface-2); }
.et-trv__section { border-top: 1px solid var(--color-border-default); padding-top: var(--space-2); display: flex; flex-direction: column; gap: var(--space-1-5); }
.et-trv__section-header { display: flex; align-items: center; gap: var(--space-2); font-size: var(--type-body); font-weight: var(--font-semibold); color: var(--color-text-secondary); }
.et-trv__row { display: flex; align-items: center; gap: var(--space-2); }
.et-trv__row-label { font-size: var(--type-body); color: var(--color-text-tertiary); flex: 1; }
.et-trv__row-value { font-size: var(--type-body); font-weight: var(--font-bold); color: var(--color-text-primary); min-width: 20px; text-align: center; }
.et-trv__toggle { padding: 0.2rem var(--space-2); border-radius: var(--radius-sm); border: 1px solid var(--color-border-default); background: var(--color-surface-2); color: var(--color-text-disabled); font-size: var(--type-body); font-weight: var(--font-semibold); cursor: pointer; min-width: 40px; text-align: center; }
.et-trv__toggle--on { background: var(--color-primary-subtle); border-color: var(--color-primary); color: var(--color-primary); }
.et-trv__input { padding: 0.2rem 0.4rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border-default); background: var(--color-surface-2); color: var(--color-text-primary); font-size: var(--type-body); }
.et-trv__select { padding: 0.2rem 0.4rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border-default); background: var(--color-surface-2); color: var(--color-text-primary); font-size: var(--type-body); cursor: pointer; }
.et-trv__range { flex: 1; accent-color: var(--color-primary); }
.et-trv__rule { display: flex; align-items: center; gap: var(--space-2); font-size: var(--type-body); color: var(--color-text-tertiary); padding: var(--space-0-5) 0; }
.et-trv__rule-del { background: none; border: none; color: var(--color-text-disabled); cursor: pointer; font-size: var(--type-body); }
.et-trv__rule-del:hover { color: var(--color-danger-text); }
.et-trv__sched-rule { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2) 0; border-bottom: 1px solid var(--color-border-default); }
.et-trv__sched-row { display: flex; align-items: center; gap: var(--space-2); }
.et-trv__sched-days { display: flex; gap: var(--space-1); flex-wrap: wrap; }
.et-trv__day-btn {
    padding: var(--space-0-5) var(--space-1-5); border-radius: var(--radius-sm); border: 1px solid var(--color-border-default);
    background: var(--color-surface-2); color: var(--color-text-disabled); font-size: var(--type-body);
    font-weight: var(--font-semibold); cursor: pointer; min-width: 30px; text-align: center;
}
.et-trv__day-btn--on { background: var(--color-primary-subtle); border-color: var(--color-primary); color: var(--color-primary); }
.et-trv__sched-add { padding-top: var(--space-2); display: flex; flex-direction: column; gap: var(--space-1); }
.et-trv__empty-hint { font-size: var(--type-body); color: var(--color-text-disabled); }
.et-trv__info { display: flex; flex-wrap: wrap; gap: var(--space-3); padding-top: var(--space-2); border-top: 1px solid var(--color-border-default); }
.et-trv__info-item { display: flex; align-items: center; gap: var(--space-1); font-size: var(--type-body); color: var(--color-text-tertiary); }
.et-trv__info-item i { font-size: var(--type-body); opacity: 0.7; }
.et-trv__info-item--update { color: var(--color-primary); font-weight: var(--font-semibold); }
.et-trv__error-msg { font-size: var(--type-body); color: var(--color-danger-text); display: flex; align-items: center; gap: var(--space-1); }
</style>

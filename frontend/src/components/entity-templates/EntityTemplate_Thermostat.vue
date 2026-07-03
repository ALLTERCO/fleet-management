<template>
    <div class="et">
        <!-- Empty state — thermostat not yet provisioned -->
        <div v-if="!hasData" class="et-thermo__empty">
            <i class="fas fa-thermometer-empty et-thermo__empty-icon" aria-hidden="true" />
            <span class="et-thermo__empty-text">Thermostat not configured</span>
            <button
                v-if="canExecute"
                type="button"
                class="et__chip et__chip--primary et-thermo__create"
                :disabled="busy"
                @click="createThermostat"
            >
                <i :class="busy ? 'fas fa-spinner fa-spin' : 'fas fa-plus'" />
                <span>Create thermostat</span>
            </button>
        </div>

        <template v-else>
            <!-- Hero: current temperature reading -->
            <header class="et__hero">
                <div class="et__hero-value">{{ currentDisplay }}</div>
                <div class="et__hero-label">Current temperature</div>
            </header>

            <!-- Primary affordance: heating on/off + target indicator -->
            <button
                type="button"
                class="et__primary"
                :class="{
                    'et__primary--on': isEnabled,
                    'et__primary--readonly': !canExecute
                }"
                :disabled="!canExecute"
                :aria-pressed="isEnabled"
                @click="canExecute && emit('toggle')"
            >
                <span class="et__primary-text">
                    <span class="et__primary-state">{{ isEnabled ? 'Heating on' : 'Heating off' }}</span>
                    <span class="et__primary-source">Target {{ targetDisplay }}</span>
                </span>
                <span class="et__primary-icon" aria-hidden="true">
                    <i class="fas fa-power-off" />
                </span>
            </button>

            <!-- Target slider (when heating is enabled and user has permission) -->
            <div v-if="canExecute && isEnabled" class="et__slider-row">
                <div class="et__slider-head">
                    <span class="et__slider-label">Target temperature</span>
                    <span class="et__slider-value">{{ targetTemp }}°C</span>
                </div>
                <HorizontalSlider
                    :value="targetTemp"
                    :min="5"
                    :max="35"
                    :step="0.5"
                    :saved="{ '18°': 18, '20°': 20, '22°': 22, '24°': 24 }"
                    @change="(v: number) => emit('set-target', v)"
                >
                    <template #title>Target ({{ targetTemp }}°C)</template>
                </HorizontalSlider>
            </div>

            <!-- Extra metrics as KPI strip -->
            <ul v-if="extras.length > 0" class="et__kpis">
                <li v-for="m in extras" :key="m.label" class="et__kpi">
                    <span class="et__kpi-value">{{ m.value }}</span>
                    <span class="et__kpi-label">{{ m.label }}</span>
                </li>
            </ul>

            <!-- Schedule (prominent: own panel since it's frequent) -->
            <section v-if="canExecute" class="et__panel">
                <div class="et__panel-row">
                    <span><i class="fas fa-calendar" /> Schedule</span>
                    <button
                        type="button"
                        class="et__switch"
                        :class="scheduleEnabled && 'et__switch--on'"
                        :aria-pressed="scheduleEnabled"
                        @click="toggleSchedule"
                    ><span class="et__switch-thumb" /></button>
                </div>

                <div v-for="profile in profiles" :key="profile.id" class="et-thermo__profile">
                    <i class="fas fa-list" aria-hidden="true" />
                    <span class="et-thermo__profile-name">{{ profile.name }}</span>
                    <button
                        type="button"
                        class="et-thermo__icon-btn"
                        :aria-label="`Load rules for ${profile.name}`"
                        @click="loadRules(profile.id)"
                    >
                        <i :class="loadingRules === profile.id ? 'fas fa-spinner fa-spin' : 'fas fa-eye'" />
                    </button>
                </div>

                <div v-if="activeRules.length > 0" class="et-thermo__rules">
                    <div v-for="rule in activeRules" :key="rule.id ?? rule.rule_id" class="et-thermo__rule">
                        <span class="et-thermo__rule-time">{{ formatRuleTime(rule) }}</span>
                        <span class="et-thermo__rule-temp">{{ rule.target_C ?? '—' }}°C</span>
                        <span class="et-thermo__rule-days">{{ formatDays(rule.days) }}</span>
                        <button
                            type="button"
                            class="et-thermo__icon-btn et-thermo__icon-btn--danger"
                            aria-label="Delete rule"
                            @click="deleteRule(rule.id ?? rule.rule_id)"
                        >
                            <i class="fas fa-xmark" />
                        </button>
                    </div>
                </div>

                <!-- Add rule -->
                <div v-if="activeProfileId != null" class="et-thermo__add-rule">
                    <input v-model="newRuleTime" type="time" class="et__text et-thermo__time-input" aria-label="Rule time" />
                    <input
                        v-model.number="newRuleTemp"
                        type="number"
                        min="5"
                        max="35"
                        step="0.5"
                        class="et__num"
                        placeholder="°C"
                        aria-label="Target temperature"
                    />
                    <button type="button" class="et__chip" :disabled="!newRuleTime" @click="addRule">
                        <i class="fas fa-plus" /><span>Add</span>
                    </button>
                </div>

                <!-- Profile management -->
                <div class="et-thermo__profile-mgmt">
                    <input
                        v-model="newProfileName"
                        type="text"
                        class="et__text"
                        placeholder="New profile name"
                        aria-label="New profile name"
                    />
                    <button type="button" class="et__chip" :disabled="!newProfileName" @click="createProfile">
                        <i class="fas fa-plus" /><span>Profile</span>
                    </button>
                </div>

                <div v-if="!profiles.length" class="et-thermo__empty-hint">No schedule profiles yet.</div>
            </section>

            <!-- Configure: thermostat settings -->
            <details v-if="canExecute && thermoConfig" class="et__configure">
                <summary class="et__configure-summary">
                    <span><i class="fas fa-gear" /> Configure</span>
                    <i class="fas fa-chevron-down et__configure-chevron" />
                </summary>

                <div class="et__configure-body">
                    <section class="et__group">
                        <div class="et__form">
                            <div class="et__form-row et__form-row--inline">
                                <span class="et__form-label">Type</span>
                                <span class="et__panel-value">{{ thermoConfig.type ?? '—' }}</span>
                            </div>
                            <label class="et__form-row">
                                <span class="et__form-label">Display unit</span>
                                <select
                                    class="et__select"
                                    :value="thermoConfig.display_unit ?? 'C'"
                                    @change="(e: Event) => setThermoConfig({display_unit: (e.target as HTMLSelectElement).value})"
                                >
                                    <option value="C">°C</option>
                                    <option value="F">°F</option>
                                </select>
                            </label>
                            <div class="et__form-row et__form-row--inline">
                                <span class="et__form-label">Hysteresis</span>
                                <span class="et__panel-value">{{ thermoConfig.hysteresis ?? 0 }}°</span>
                            </div>
                            <div class="et__form-row et__form-row--inline">
                                <span class="et__form-label">Invert output</span>
                                <button
                                    type="button"
                                    class="et__switch"
                                    :class="thermoConfig.invert_output && 'et__switch--on'"
                                    :aria-pressed="!!thermoConfig.invert_output"
                                    @click="setThermoConfig({invert_output: !thermoConfig.invert_output})"
                                ><span class="et__switch-thumb" /></button>
                            </div>
                            <div class="et__form-row et__form-row--inline">
                                <span class="et__form-label">Failure detection</span>
                                <button
                                    type="button"
                                    class="et__switch"
                                    :class="thermoConfig.failure_detection && 'et__switch--on'"
                                    :aria-pressed="!!thermoConfig.failure_detection"
                                    @click="setThermoConfig({failure_detection: !thermoConfig.failure_detection})"
                                ><span class="et__switch-thumb" /></button>
                            </div>
                        </div>
                    </section>
                </div>
            </details>

            <!-- Danger zone: delete thermostat -->
            <div v-if="canExecute" class="et__chip-row">
                <button
                    type="button"
                    class="et__chip et__chip--danger"
                    :disabled="busy"
                    @click="deleteThermostat"
                >
                    <span>Delete thermostat</span>
                </button>
            </div>
        </template>

        <div v-if="thermoError" class="et__error" role="alert">
            <i class="fas fa-triangle-exclamation" /> {{ thermoError }}
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from 'vue';
import HorizontalSlider from '@/components/core/HorizontalSlider.vue';
import {sendRPC} from '@/tools/websocket';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    shellyID?: string;
}>();

const emit = defineEmits<{
    toggle: [];
    'set-target': [value: number];
}>();

const busy = ref(false);
const thermoError = ref<string | null>(null);
const profiles = ref<Array<{id: number; name: string}>>([]);
const activeRules = ref<Array<Record<string, any>>>([]);
const loadingRules = ref<number | null>(null);
const activeProfileId = ref<number | null>(null);
const newRuleTime = ref('08:00');
const newRuleTemp = ref(22);
const newProfileName = ref('');

const hasData = computed(() => {
    const s = props.status;
    return s && (s.current_C != null || s.target_C != null || s.enable != null);
});

const currentTemp = computed(() => {
    const v = props.status?.current_C;
    return typeof v === 'number' ? v : null;
});

const targetTemp = computed(() => {
    const v = props.status?.target_C;
    return typeof v === 'number' ? v : 20;
});

const isEnabled = computed(() => !!props.status?.enable);
const thermoConfig = computed(() => props.settings ?? null);
const scheduleEnabled = computed(() => !!props.status?.schedules?.enable);

const currentDisplay = computed(() => {
    if (currentTemp.value === null) return 'N/A';
    return `${currentTemp.value.toFixed(1)}°C`;
});

const targetDisplay = computed(() => {
    if (props.status?.target_C == null) return 'N/A';
    return `${targetTemp.value.toFixed(1)}°C`;
});

const SKIP_KEYS = new Set([
    'id',
    'current_C',
    'target_C',
    'enable',
    'output',
    'errors',
    'schedules'
]);

const extras = computed(() => {
    const s = props.status;
    if (!s) return [];
    const out: {label: string; value: string}[] = [];
    if (s.output !== undefined)
        out.push({label: 'Output', value: s.output ? 'Active' : 'Idle'});
    if (s.errors?.length)
        out.push({label: 'Errors', value: s.errors.join(', ')});
    for (const [k, v] of Object.entries(s)) {
        if (SKIP_KEYS.has(k)) continue;
        if (typeof v === 'number')
            out.push({label: formatKey(k), value: String(v)});
        else if (typeof v === 'string' && v)
            out.push({label: formatKey(k), value: v});
        else if (typeof v === 'boolean')
            out.push({label: formatKey(k), value: v ? 'Yes' : 'No'});
    }
    return out;
});

function formatKey(key: string): string {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDays(days?: string[]): string {
    if (!days?.length) return '';
    const map: Record<string, string> = {
        Mon: 'M',
        Tue: 'T',
        Wed: 'W',
        Thu: 'T',
        Fri: 'F',
        Sat: 'S',
        Sun: 'S'
    };
    return days.map((d) => map[d] ?? d).join('');
}

async function sendFm<T = unknown>(
    method: string,
    params: Record<string, any>
): Promise<T | null> {
    if (!props.shellyID) return null;
    thermoError.value = null;
    try {
        return await sendRPC<T>('FLEET_MANAGER', method, {
            shellyID: props.shellyID,
            ...params
        });
    } catch (e: any) {
        thermoError.value = e.message || `${method} failed`;
        return null;
    }
}

async function setThermoConfig(config: Record<string, any>) {
    const id = props.status?.id ?? props.settings?.id ?? 0;
    await sendFm('Thermostat.SetConfig', {id, config});
}

async function createThermostat() {
    busy.value = true;
    await sendFm('Thermostat.Create', {config: {}});
    busy.value = false;
}

async function deleteThermostat() {
    if (!confirm('Delete thermostat? This cannot be undone.')) return;
    busy.value = true;
    const id = props.status?.id ?? props.settings?.id ?? 0;
    await sendFm('Thermostat.Delete', {id});
    busy.value = false;
}

async function toggleSchedule() {
    const id = props.status?.id ?? props.settings?.id ?? 0;
    await sendFm('Thermostat.Schedule.SetConfig', {
        id,
        enable: !scheduleEnabled.value
    });
}

async function loadRules(profileId: number) {
    loadingRules.value = profileId;
    activeProfileId.value = profileId;
    const id = props.status?.id ?? props.settings?.id ?? 0;
    const result = await sendFm<{rules?: Array<Record<string, any>>}>(
        'Thermostat.Schedule.ListRules',
        {id, profile_id: profileId}
    );
    activeRules.value = result?.rules ?? [];
    loadingRules.value = null;
}

async function addRule() {
    if (activeProfileId.value == null) return;
    const id = props.status?.id ?? props.settings?.id ?? 0;
    const [h, m] = newRuleTime.value.split(':').map(Number);
    await sendFm('Thermostat.Schedule.AddRule', {
        id,
        profile_id: activeProfileId.value,
        hour: h,
        minute: m,
        target_C: newRuleTemp.value,
        enable: true
    });
    loadRules(activeProfileId.value);
}

async function deleteRule(ruleId: number) {
    const id = props.status?.id ?? props.settings?.id ?? 0;
    await sendFm('Thermostat.Schedule.DeleteRule', {id, ruleId});
    if (activeProfileId.value != null) loadRules(activeProfileId.value);
}

async function createProfile() {
    if (!newProfileName.value) return;
    const id = props.status?.id ?? props.settings?.id ?? 0;
    await sendFm('Thermostat.Schedule.AddProfile', {
        id,
        name: newProfileName.value
    });
    newProfileName.value = '';
    const result = await sendFm<{profiles?: Array<{id: number; name: string}>}>(
        'Thermostat.Schedule.ListProfiles',
        {id}
    );
    profiles.value = result?.profiles ?? [];
}

function formatRuleTime(rule: Record<string, any>): string {
    if (rule.hour != null && rule.minute != null) {
        return `${String(rule.hour).padStart(2, '0')}:${String(rule.minute).padStart(2, '0')}`;
    }
    return rule.time ?? '—';
}

onMounted(async () => {
    if (!props.shellyID || !hasData.value) return;
    const id = props.status?.id ?? props.settings?.id ?? 0;
    const result = await sendFm<{profiles?: Array<{id: number; name: string}>}>(
        'Thermostat.Schedule.ListProfiles',
        {id}
    );
    profiles.value = result?.profiles ?? [];
});
</script>

<style src="./entityTemplate.css"></style>

<style scoped>
/* Thermostat-specific: empty state + schedule profile/rule rows */
.et-thermo__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-6) var(--space-4);
    text-align: center;
}
.et-thermo__empty-icon {
    font-size: var(--type-heading);
    color: var(--color-text-quaternary);
}
.et-thermo__empty-text {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    font-weight: var(--font-medium);
}
.et-thermo__empty-hint {
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
    text-align: center;
}
.et-thermo__create {
    width: auto;
}
.et-thermo__profile {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.et-thermo__profile-name {
    flex: 1;
}
.et-thermo__icon-btn {
    appearance: none;
    background: none;
    border: 1px solid transparent;
    color: var(--color-text-tertiary);
    cursor: pointer;
    font-size: var(--type-body);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    transition: background-color var(--motion-state), color var(--motion-state);
}
.et-thermo__icon-btn:hover {
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
}
.et-thermo__icon-btn--danger:hover {
    color: var(--color-danger-text);
}
.et-thermo__rules {
    padding-left: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.et-thermo__rule {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.et-thermo__rule-time {
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    min-width: 48px;
    font-variant-numeric: tabular-nums;
}
.et-thermo__rule-temp {
    color: var(--color-primary-text);
    font-weight: var(--font-semibold);
    min-width: 48px;
    font-variant-numeric: tabular-nums;
}
.et-thermo__rule-days {
    color: var(--color-text-quaternary);
}
.et-thermo__add-rule {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-left: var(--space-5);
    flex-wrap: wrap;
}
.et-thermo__time-input {
    width: auto;
    min-width: 0;
}
.et-thermo__profile-mgmt {
    display: flex;
    gap: var(--space-2);
    align-items: center;
}
</style>

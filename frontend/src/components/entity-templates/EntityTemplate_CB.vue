<template>
    <div class="et">
        <!-- Hero: breaker state -->
        <header class="et__hero">
            <div class="et__hero-value" :class="isOn ? 'is-on' : 'is-off'">
                {{ isOn ? 'On' : 'Off' }}
            </div>
            <div class="et__hero-label">
                <span v-if="isSafety">{{ tripCause }} trip — reset the lever at the device</span>
                <span v-else-if="isOn">Breaker closed — power flowing</span>
                <span v-else>Breaker open</span>
            </div>
        </header>

        <!-- Safety / fault banner -->
        <div v-if="isSafety" class="et__banner et__banner--danger" role="alert">
            <i class="fas fa-triangle-exclamation" />
            <span class="et__banner-list">
                <span>Protection latched — cannot re-engage remotely, reset the lever</span>
                <span v-for="err in status?.errors ?? []" :key="err">{{ err }}</span>
            </span>
        </div>

        <!-- Primary affordance: on/off toggle (relay). Re-engage blocked while latched. -->
        <button
            type="button"
            class="et__primary"
            :class="{
                'et__primary--on': isOn,
                'et__primary--readonly': !canToggle
            }"
            :disabled="!canToggle"
            :aria-pressed="isOn"
            @click="toggle"
        >
            <span class="et__primary-text">
                <span class="et__primary-state">{{ isOn ? 'Turn off' : 'Turn on' }}</span>
                <span v-if="latchedOff" class="et__primary-source">Reset lever to re-arm</span>
                <span v-else-if="status?.source" class="et__primary-source">via {{ status.source }}</span>
            </span>
            <span class="et__primary-icon" aria-hidden="true">
                <i class="fas fa-power-off" />
            </span>
        </button>

        <!-- KPI strip: telemetry -->
        <ul class="et__kpis">
            <li class="et__kpi">
                <span class="et__kpi-value">{{ tempDisplay }}</span>
                <span class="et__kpi-label">Temperature</span>
            </li>
            <li class="et__kpi">
                <span class="et__kpi-value">{{ cyclesDisplay }}</span>
                <span class="et__kpi-label">Total cycles</span>
            </li>
            <li class="et__kpi">
                <span class="et__kpi-value">{{ isSafety ? 'Fault' : 'OK' }}</span>
                <span class="et__kpi-label">Safety</span>
            </li>
        </ul>

        <!-- Configure: protection thresholds + auto-recovery -->
        <details v-if="canExecute && settings && props.shellyID" class="et__configure">
            <summary class="et__configure-summary">
                <span><i class="fas fa-gear" /> Configure</span>
                <i class="fas fa-chevron-down et__configure-chevron" />
            </summary>

            <div class="et__configure-body">
                <section class="et__group">
                    <div class="et__form">
                        <label class="et__form-row">
                            <span class="et__form-label">Name</span>
                            <input
                                type="text"
                                class="et__text"
                                :value="settings.name ?? ''"
                                placeholder="Breaker name"
                                @change="(e: Event) => setConfig({name: (e.target as HTMLInputElement).value})"
                            />
                        </label>
                        <label v-if="settings.undervoltage_limit != null" class="et__form-row">
                            <span class="et__form-label">Undervoltage limit</span>
                            <span class="et__inline-num">
                                <input
                                    type="number"
                                    class="et__num"
                                    :value="settings.undervoltage_limit"
                                    min="0"
                                    @change="(e: Event) => setConfig({undervoltage_limit: Number((e.target as HTMLInputElement).value)})"
                                />
                                <span class="et__unit">V</span>
                            </span>
                        </label>
                        <label v-if="settings.voltage_limit != null" class="et__form-row">
                            <span class="et__form-label">Overvoltage limit</span>
                            <span class="et__inline-num">
                                <input
                                    type="number"
                                    class="et__num"
                                    :value="settings.voltage_limit"
                                    min="0"
                                    @change="(e: Event) => setConfig({voltage_limit: Number((e.target as HTMLInputElement).value)})"
                                />
                                <span class="et__unit">V</span>
                            </span>
                        </label>
                        <label v-if="settings.reaction_delay != null" class="et__form-row">
                            <span class="et__form-label">Reaction delay</span>
                            <span class="et__inline-num">
                                <input
                                    type="number"
                                    class="et__num"
                                    :value="settings.reaction_delay"
                                    min="0"
                                    step="0.1"
                                    @change="(e: Event) => setConfig({reaction_delay: Number((e.target as HTMLInputElement).value)})"
                                />
                                <span class="et__unit">s</span>
                            </span>
                        </label>
                        <label v-if="settings.voltage_thr != null" class="et__form-row">
                            <span class="et__form-label">Voltage threshold</span>
                            <span class="et__inline-num">
                                <input
                                    type="number"
                                    class="et__num"
                                    :value="settings.voltage_thr"
                                    min="0"
                                    @change="(e: Event) => setConfig({voltage_thr: Number((e.target as HTMLInputElement).value)})"
                                />
                                <span class="et__unit">V</span>
                            </span>
                        </label>
                        <div v-if="settings.autorecovery_enable != null" class="et__form-row et__form-row--inline">
                            <span class="et__form-label">Auto-recovery</span>
                            <button
                                type="button"
                                class="et__switch"
                                :class="settings.autorecovery_enable && 'et__switch--on'"
                                :aria-pressed="!!settings.autorecovery_enable"
                                @click="setConfig({autorecovery_enable: !settings.autorecovery_enable})"
                            ><span class="et__switch-thumb" /></button>
                        </div>
                        <label v-if="settings.autorecovery_enable && settings.autorecovery_delay != null" class="et__form-row">
                            <span class="et__form-label">Auto-recovery delay</span>
                            <span class="et__inline-num">
                                <input
                                    type="number"
                                    class="et__num"
                                    :value="settings.autorecovery_delay"
                                    min="0"
                                    step="0.1"
                                    @change="(e: Event) => setConfig({autorecovery_delay: Number((e.target as HTMLInputElement).value)})"
                                />
                                <span class="et__unit">s</span>
                            </span>
                        </label>
                        <p v-if="configError" class="et__error">{{ configError }}</p>
                    </div>
                </section>
            </div>
        </details>

        <!-- Read-only summary when the user can't execute -->
        <dl v-else-if="settings" class="et__kv">
            <div v-if="settings.undervoltage_limit != null" class="et__kv-row">
                <dt>Undervoltage limit</dt><dd>{{ settings.undervoltage_limit }} V</dd>
            </div>
            <div v-if="settings.voltage_limit != null" class="et__kv-row">
                <dt>Overvoltage limit</dt><dd>{{ settings.voltage_limit }} V</dd>
            </div>
            <div v-if="settings.autorecovery_enable != null" class="et__kv-row">
                <dt>Auto-recovery</dt><dd>{{ settings.autorecovery_enable ? 'On' : 'Off' }}</dd>
            </div>
        </dl>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {sendRPC} from '@/tools/websocket';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    shellyID?: string;
    entityId?: string;
}>();

const emit = defineEmits<{setOutput: [on: boolean]}>();

const configError = ref<string | null>(null);

const isOn = computed(() => !!props.status?.output);
const isSafety = computed(
    () => !!props.status?.safety || (props.status?.errors?.length ?? 0) > 0
);
// A safety-latched breaker turns OFF but not back ON remotely — reset the lever.
const latchedOff = computed(() => isSafety.value && !isOn.value);
const canToggle = computed(() => props.canExecute && !latchedOff.value);

const tripCause = computed(() => {
    const src = String(props.status?.source ?? '');
    if (src === 'overvoltage') return 'Overvoltage';
    if (src === 'undervoltage') return 'Undervoltage';
    if (src === 'safety_switch') return 'Safety';
    return 'Protection';
});

const tempDisplay = computed(() => {
    const t = props.status?.temperature?.tC;
    return typeof t === 'number' ? `${Math.round(t)}°C` : '—';
});
const cyclesDisplay = computed(() => {
    const c = props.status?.total_cycles;
    return typeof c === 'number' ? String(c) : '—';
});

function toggle() {
    if (!canToggle.value) return;
    emit('setOutput', !isOn.value);
}

async function setConfig(config: Record<string, any>) {
    configError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'CB.SetConfig', {
            shellyID: props.shellyID,
            id: props.status?.id ?? 0,
            config
        });
    } catch (e: any) {
        configError.value = e?.message || 'Failed to set config';
    }
}
</script>

<style scoped>
.et__hero-value.is-on {
    color: var(--color-status-on, var(--color-success-text));
}
.et__hero-value.is-off {
    color: var(--color-status-off, var(--color-danger-text));
}
.et__inline-num {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
}
.et__error {
    color: var(--color-danger-text, var(--color-danger));
    font-size: var(--type-caption);
    margin-top: var(--space-2);
}
</style>

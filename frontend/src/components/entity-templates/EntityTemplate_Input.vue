<template>
    <div class="et-input">
        <!-- Current state (centered) -->
        <div class="et-input__state-display">
            <div v-if="inputType === 'switch'" class="et-input__state">
                <i class="fas" :class="isOn ? 'fa-toggle-on et-input__icon--on' : 'fa-toggle-off et-input__icon--off'" />
                <span :class="isOn ? 'et-input__text--on' : 'et-input__text--off'">{{ isOn ? 'ON' : 'OFF' }}</span>
            </div>
            <div v-else-if="inputType === 'analog'" class="et-input__state">
                <i class="fas fa-gauge et-input__icon--analog" />
                <span>{{ analogValue }}</span>
            </div>
            <div v-else-if="inputType === 'count'" class="et-input__state">
                <i class="fas fa-calculator et-input__icon--count" />
                <span>{{ countValue }}</span>
            </div>
            <div v-else-if="inputType === 'button'" class="et-input__state">
                <i class="fas fa-circle-dot et-input__icon--button" />
                <span>{{ lastEvent || 'No event' }}</span>
            </div>
            <div v-else class="et-input__state">
                <i class="fas fa-arrow-right" />
                <span>{{ inputType || 'Input' }}</span>
            </div>
        </div>

        <!-- Errors -->
        <div v-if="status?.errors?.length" class="et-input__errors">
            <div v-for="err in status.errors" :key="err" class="et-input__error-item">
                <i class="fas fa-triangle-exclamation" />
                <span>{{ err }}</span>
            </div>
        </div>

        <!-- Count details (frequency + by_minute) -->
        <div v-if="inputType === 'count'" class="et-input__count-details">
            <div v-if="status?.freq != null" class="et-input__kv">
                <span>Frequency</span>
                <span>{{ status.xfreq != null ? status.xfreq : status.freq }} Hz</span>
            </div>
            <div v-if="status?.counts?.by_minute?.length" class="et-input__kv">
                <span>Last 3 min</span>
                <span>{{ status.counts.by_minute.join(' / ') }}</span>
            </div>
            <button
                v-if="canExecute && shellyID"
                class="et-input__reset-btn"
                @click="resetCounters"
            >
                <i class="fas fa-rotate-left" /> Reset Counters
            </button>
        </div>

        <!-- Input settings -->
        <div v-if="canExecute && settings && shellyID" class="et-input__section">
            <div
                class="et-input__section-header"
                role="button"
                tabindex="0"
                :aria-expanded="!collapsed.has('settings')"
                @click="toggleSection('settings')"
                @keydown="onSectionKey($event, 'settings')"
            >
                <i class="fas fa-sliders" /> Input Settings
                <i class="fas et-input__chevron" :class="collapsed.has('settings') ? 'fa-chevron-right' : 'fa-chevron-down'" />
            </div>

            <template v-if="!collapsed.has('settings')">
                <!-- Name -->
                <div v-if="settings.name != null" class="et-input__row">
                    <span class="et-input__row-label">Name</span>
                    <input
                        type="text"
                        class="et-input__text-field"
                        :value="settings.name"
                        placeholder="Input name"
                        @change="(e: Event) => setConfig({name: (e.target as HTMLInputElement).value})"
                    />
                </div>

                <!-- Enable -->
                <div v-if="settings.enable != null" class="et-input__row">
                    <span class="et-input__row-label">Enable</span>
                    <button
                        class="et-input__toggle-btn"
                        :class="settings.enable !== false && 'et-input__toggle-btn--on'"
                        @click="setConfig({enable: settings.enable === false})"
                    >
                        <i class="fas" :class="settings.enable !== false ? 'fa-toggle-on' : 'fa-toggle-off'" />
                    </button>
                </div>

                <!-- Invert -->
                <div v-if="settings.invert != null" class="et-input__row">
                    <span class="et-input__row-label">Invert</span>
                    <button
                        class="et-input__toggle-btn"
                        :class="settings.invert && 'et-input__toggle-btn--on'"
                        @click="setConfig({invert: !settings.invert})"
                    >
                        <i class="fas" :class="settings.invert ? 'fa-toggle-on' : 'fa-toggle-off'" />
                    </button>
                </div>

                <!-- Input type -->
                <div v-if="settings.type != null" class="et-input__row">
                    <span class="et-input__row-label">Type</span>
                    <select
                        class="et-input__select"
                        :value="settings.type"
                        @change="(e: Event) => setConfig({type: (e.target as HTMLSelectElement).value})"
                    >
                        <option value="button">Button</option>
                        <option value="switch">Switch</option>
                        <option value="analog">Analog</option>
                        <option value="count">Count</option>
                    </select>
                </div>

                <!-- Analog settings -->
                <template v-if="inputType === 'analog'">
                    <div v-if="settings.report_thr != null" class="et-input__row">
                        <span class="et-input__row-label">Report threshold</span>
                        <input type="number" class="et-input__number" :value="settings.report_thr" min="1" max="50" step="0.1"
                            @change="(e: Event) => setConfig({report_thr: Number((e.target as HTMLInputElement).value)})" />
                    </div>
                    <div v-if="settings.range != null" class="et-input__row">
                        <span class="et-input__row-label">Analog range</span>
                        <select class="et-input__select" :value="settings.range"
                            @change="(e: Event) => setConfig({range: Number((e.target as HTMLSelectElement).value)})">
                            <option :value="0">Range 0</option>
                            <option :value="1">Range 1</option>
                        </select>
                    </div>
                    <div v-if="settings.range_map?.length === 2" class="et-input__row">
                        <span class="et-input__row-label">Range map</span>
                        <div class="et-input__range-row">
                            <input type="number" class="et-input__number" :value="settings.range_map[0]" min="0" max="100"
                                @change="(e: Event) => setConfig({range_map: [Number((e.target as HTMLInputElement).value), settings!.range_map[1]]})" />
                            <span>–</span>
                            <input type="number" class="et-input__number" :value="settings.range_map[1]" min="0" max="100"
                                @change="(e: Event) => setConfig({range_map: [settings!.range_map[0], Number((e.target as HTMLInputElement).value)]})" />
                        </div>
                    </div>
                    <div v-if="settings.xpercent" class="et-input__row">
                        <span class="et-input__row-label">Transform expr</span>
                        <input type="text" class="et-input__text-field" :value="settings.xpercent.expr ?? ''" placeholder="e.g. x*100"
                            @change="(e: Event) => setConfig({xpercent: {expr: (e.target as HTMLInputElement).value || null}})" />
                    </div>
                    <div v-if="settings.xpercent" class="et-input__row">
                        <span class="et-input__row-label">Unit</span>
                        <input type="text" class="et-input__text-field" :value="settings.xpercent.unit ?? ''" placeholder="%"
                            @change="(e: Event) => setConfig({xpercent: {unit: (e.target as HTMLInputElement).value || null}})" />
                    </div>
                </template>

                <!-- Count settings -->
                <template v-if="inputType === 'count'">
                    <div v-if="settings.count_rep_thr != null" class="et-input__row">
                        <span class="et-input__row-label">Count threshold</span>
                        <input type="number" class="et-input__number" :value="settings.count_rep_thr" min="1"
                            @change="(e: Event) => setConfig({count_rep_thr: Number((e.target as HTMLInputElement).value)})" />
                    </div>
                    <div v-if="settings.freq_window != null" class="et-input__row">
                        <span class="et-input__row-label">Freq window</span>
                        <input type="number" class="et-input__number" :value="settings.freq_window" min="1" max="3600"
                            @change="(e: Event) => setConfig({freq_window: Number((e.target as HTMLInputElement).value)})" />
                        <span class="et-input__unit">sec</span>
                    </div>
                    <div v-if="settings.freq_rep_thr != null" class="et-input__row">
                        <span class="et-input__row-label">Freq threshold</span>
                        <input type="number" class="et-input__number" :value="settings.freq_rep_thr" min="0" max="10000"
                            @change="(e: Event) => setConfig({freq_rep_thr: Number((e.target as HTMLInputElement).value)})" />
                    </div>
                    <div v-if="settings.xcounts" class="et-input__row">
                        <span class="et-input__row-label">Count expr</span>
                        <input type="text" class="et-input__text-field" :value="settings.xcounts.expr ?? ''" placeholder="e.g. x*0.001"
                            @change="(e: Event) => setConfig({xcounts: {expr: (e.target as HTMLInputElement).value || null}})" />
                    </div>
                    <div v-if="settings.xcounts" class="et-input__row">
                        <span class="et-input__row-label">Count unit</span>
                        <input type="text" class="et-input__text-field" :value="settings.xcounts.unit ?? ''" placeholder="pulses"
                            @change="(e: Event) => setConfig({xcounts: {unit: (e.target as HTMLInputElement).value || null}})" />
                    </div>
                    <div v-if="settings.xfreq" class="et-input__row">
                        <span class="et-input__row-label">Freq expr</span>
                        <input type="text" class="et-input__text-field" :value="settings.xfreq.expr ?? ''" placeholder="e.g. x*60"
                            @change="(e: Event) => setConfig({xfreq: {expr: (e.target as HTMLInputElement).value || null}})" />
                    </div>
                    <div v-if="settings.xfreq" class="et-input__row">
                        <span class="et-input__row-label">Freq unit</span>
                        <input type="text" class="et-input__text-field" :value="settings.xfreq.unit ?? ''" placeholder="Hz"
                            @change="(e: Event) => setConfig({xfreq: {unit: (e.target as HTMLInputElement).value || null}})" />
                    </div>
                </template>

                <!-- Factory reset -->
                <div v-if="settings.factory_reset != null" class="et-input__row">
                    <span class="et-input__row-label">Factory reset</span>
                    <button
                        class="et-input__toggle-btn"
                        :class="settings.factory_reset && 'et-input__toggle-btn--on'"
                        @click="setConfig({factory_reset: !settings.factory_reset})"
                    >
                        <i class="fas" :class="settings.factory_reset ? 'fa-toggle-on' : 'fa-toggle-off'" />
                    </button>
                </div>

            </template>
        </div>

        <!-- Read-only settings (no execute permission) -->
        <div v-else-if="settings" class="et-input__section">
            <div
                class="et-input__section-header"
                role="button"
                tabindex="0"
                :aria-expanded="!collapsed.has('settings')"
                @click="toggleSection('settings')"
                @keydown="onSectionKey($event, 'settings')"
            >
                <i class="fas fa-sliders" /> Input Settings
                <i class="fas et-input__chevron" :class="collapsed.has('settings') ? 'fa-chevron-right' : 'fa-chevron-down'" />
            </div>
            <template v-if="!collapsed.has('settings')">
                <div class="et-input__kv-grid">
                    <div v-if="settings.name" class="et-input__kv"><span>Name</span><span>{{ settings.name }}</span></div>
                    <div v-if="settings.type != null" class="et-input__kv"><span>Type</span><span>{{ settings.type }}</span></div>
                    <div v-if="settings.enable != null" class="et-input__kv"><span>Enabled</span><span>{{ settings.enable !== false ? 'Yes' : 'No' }}</span></div>
                    <div v-if="settings.invert != null" class="et-input__kv"><span>Inverted</span><span>{{ settings.invert ? 'Yes' : 'No' }}</span></div>
                </div>
            </template>
        </div>

        <div v-if="configError" class="et-input__error">
            <i class="fas fa-triangle-exclamation" /> {{ configError }}
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {useAccordion} from '@/composables/useAccordion';
import {useEntityStore} from '@/stores/entities';
import {sendRPC} from '@/tools/websocket';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    shellyID?: string;
    entityId?: string;
}>();

const entityStore = useEntityStore();
const configError = ref<string | null>(null);

const {collapsed, toggle: toggleSection, onKey: onSectionKey} = useAccordion();

const inputType = computed(
    () => props.settings?.type ?? props.status?.type ?? 'button'
);
const isOn = computed(() => !!props.status?.state);
const lastEvent = computed(() => props.status?.last_event ?? null);

const analogValue = computed(() => {
    const xpct = props.status?.xpercent;
    const pct = props.status?.percent;
    if (xpct != null) {
        const unit = props.settings?.xpercent?.unit || '%';
        return `${xpct} ${unit}`;
    }
    if (pct != null) return `${pct}%`;
    return 'N/A';
});

const countValue = computed(() => {
    const counts = props.status?.counts;
    if (!counts) return 'N/A';
    const xtotal = counts.xtotal;
    const total = counts.total;
    if (xtotal != null) {
        const unit = props.settings?.xcounts?.unit || '';
        return `${xtotal}${unit ? ` ${unit}` : ''}`;
    }
    return `${total ?? 0}`;
});

async function resetCounters() {
    if (!props.entityId) return;
    configError.value = null;
    try {
        await entityStore.invokeAction(props.entityId, 'resetCounters');
    } catch (e: any) {
        configError.value = e.message || 'Failed to reset counters';
    }
}

async function setConfig(config: Record<string, any>) {
    configError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Input.SetConfig', {
            shellyID: props.shellyID,
            id: props.status?.id ?? 0,
            config
        });
    } catch (e: any) {
        configError.value = e.message || 'Failed to set config';
    }
}
</script>

<style scoped>
.et-input {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

/* Centered state display */
.et-input__state-display {
    display: flex;
    align-items: center;
    justify-content: center;
}

.et-input__state {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.et-input__icon--on { color: var(--color-success-text); }
.et-input__icon--off { color: var(--color-text-disabled); }
.et-input__icon--analog { color: var(--color-primary); }
.et-input__icon--count { color: var(--color-primary); }
.et-input__icon--button { color: var(--color-warning-text); }
.et-input__text--on { color: var(--color-success-text); }
.et-input__text--off { color: var(--color-text-disabled); }

/* Errors */
.et-input__errors {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.et-input__error-item {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-danger-text);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background-color: color-mix(in srgb, var(--color-danger) 10%, transparent);
}

/* Count details */
.et-input__count-details {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.et-input__reset-btn {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) 0.625rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background-color: var(--color-surface-2);
    color: var(--color-text-disabled);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-default);
    align-self: flex-start;
}
.et-input__reset-btn:hover {
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
}

/* Range row (min–max inputs) */
.et-input__range-row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
}
.et-input__unit {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
}

/* Settings section (collapsible) */
.et-input__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    padding: var(--space-2);
}

.et-input__section-header {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    cursor: pointer;
    user-select: none;
}
.et-input__section-header:hover {
    color: var(--color-text-secondary);
}
.et-input__chevron {
    margin-left: auto;
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    transition: transform var(--duration-fast) var(--ease-default);
}

.et-input__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-1) 0;
}

.et-input__row-label {
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    flex-shrink: 0;
}

.et-input__toggle-btn {
    font-size: var(--type-subheading);
    color: var(--color-text-disabled);
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease-default);
}
.et-input__toggle-btn--on {
    color: var(--color-success-text);
}

.et-input__select {
    font-size: var(--type-body);
    color: var(--color-text-primary);
    background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-2);
    cursor: pointer;
}

.et-input__text-field {
    flex: 1;
    min-width: 0;
    font-size: var(--type-body);
    color: var(--color-text-primary);
    background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-2);
}
.et-input__text-field:focus {
    outline: none;
    border-color: var(--color-primary);
}

.et-input__number {
    width: 70px;
    font-size: var(--type-body);
    color: var(--color-text-primary);
    background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-2);
    text-align: right;
}

/* Read-only KV grid */
.et-input__kv-grid {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
}
.et-input__kv {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: var(--type-body);
}
.et-input__kv > span:first-child {
    color: var(--color-text-disabled);
}
.et-input__kv > span:last-child {
    color: var(--color-text-tertiary);
    font-weight: var(--font-medium);
}

.et-input__error {
    font-size: var(--type-body);
    color: var(--color-danger-text);
    padding: var(--space-1) 0;
}
</style>

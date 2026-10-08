<template>
    <div class="et">
        <!-- Hero: state of charge -->
        <header class="et__hero">
            <div class="et__hero-value">{{ socDisplay }}</div>
            <div class="et__hero-label">
                <span>State of charge</span>
                <span v-if="flowLabel"> — {{ flowLabel }}</span>
            </div>
        </header>

        <!-- Pack faults reported by the device -->
        <div v-if="packErrors.length" class="et__banner et__banner--danger" role="alert">
            <i class="fas fa-triangle-exclamation" />
            <span class="et__banner-list">
                <span v-for="err in packErrors" :key="err">{{ humanError(err) }}</span>
            </span>
        </div>

        <!-- KPI strip -->
        <ul class="et__kpis">
            <li class="et__kpi">
                <span class="et__kpi-value">{{ sohDisplay }}</span>
                <span class="et__kpi-label">State of health</span>
            </li>
            <li class="et__kpi">
                <span class="et__kpi-value">{{ voltageDisplay }}</span>
                <span class="et__kpi-label">Pack voltage</span>
            </li>
            <li class="et__kpi">
                <span class="et__kpi-value">{{ currentDisplay }}</span>
                <span class="et__kpi-label">Current</span>
            </li>
            <li class="et__kpi">
                <span class="et__kpi-value">{{ powerDisplay }}</span>
                <span class="et__kpi-label">Power</span>
            </li>
            <li class="et__kpi">
                <span class="et__kpi-value">{{ cyclesDisplay }}</span>
                <span class="et__kpi-label">Charge cycles</span>
            </li>
            <li class="et__kpi">
                <span class="et__kpi-value">{{ resistanceDisplay }}</span>
                <span class="et__kpi-label">Internal resistance</span>
            </li>
        </ul>

        <!-- Counters (Amp-hours, per BM.GetStatus) -->
        <section v-if="hasCounters" class="et__panel">
            <div v-if="chargedDisplay" class="et__panel-row">
                <span>Charged into battery</span>
                <span class="et__panel-value">{{ chargedDisplay }} <small>Ah</small></span>
            </div>
            <div v-if="dischargedDisplay" class="et__panel-row">
                <span>Drawn from battery</span>
                <span class="et__panel-value">{{ dischargedDisplay }} <small>Ah</small></span>
            </div>
        </section>

        <!-- Per-battery channels -->
        <section v-if="cells.length" class="et__panel">
            <div v-for="cell in cells" :key="cell.key" class="et__panel-row">
                <span>
                    {{ cell.key }}
                    <span v-if="cell.errors.length" class="et-bm__cell-fault">
                        <i class="fas fa-triangle-exclamation" />
                        {{ cell.errors.map(humanError).join(', ') }}
                    </span>
                </span>
                <span class="et__panel-value">{{ cell.readout }}</span>
            </div>
        </section>

        <!-- Maintenance: irreversible resets, each behind a confirmation -->
        <details v-if="canExecute" class="et__configure">
            <summary class="et__configure-summary">
                <span><i class="fas fa-screwdriver-wrench" /> Maintenance</span>
                <i class="fas fa-chevron-down et__configure-chevron" />
            </summary>

            <div class="et__configure-body">
                <p class="et-bm__note">
                    Each of these clears history stored on the device and cannot be undone.
                </p>
                <div class="et__chip-row">
                    <button
                        type="button"
                        class="et__chip et__chip--danger"
                        @click="confirmResetCounters"
                    >
                        <i class="fas fa-rotate-left" /><span>Reset energy counters</span>
                    </button>
                    <button
                        type="button"
                        class="et__chip et__chip--danger"
                        @click="confirmResetCharge"
                    >
                        <i class="fas fa-battery-full" /><span>Reset charge to 100%</span>
                    </button>
                    <button
                        type="button"
                        class="et__chip et__chip--danger"
                        @click="confirmReplaceBattery"
                    >
                        <i class="fas fa-car-battery" /><span>Battery replaced</span>
                    </button>
                </div>
            </div>
        </details>

        <ConfirmationModal ref="maintenanceConfirm" />
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    shellyID?: string;
    entityId?: string;
}>();

// The backend action adapter maps these verbs to the BM.* methods.
const emit = defineEmits<{
    resetCounters: [];
    resetCharge: [];
    replaceBattery: [];
}>();

const maintenanceConfirm = ref<InstanceType<typeof ConfirmationModal> | null>(
    null
);

const EMPTY = '—';

function num(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const socDisplay = computed(() => {
    const soc = num(props.status?.soc);
    return soc === null ? EMPTY : `${soc.toFixed(1)}%`;
});

const sohDisplay = computed(() => {
    const soh = num(props.status?.soh);
    return soh === null ? EMPTY : `${soh.toFixed(1)}%`;
});

const voltageDisplay = computed(() => {
    const v = num(props.status?.voltage);
    return v === null ? EMPTY : `${v.toFixed(2)} V`;
});

// BM.GetStatus: current is positive while charging, negative while discharging.
const current = computed(() => num(props.status?.current));

const currentDisplay = computed(() =>
    current.value === null ? EMPTY : `${current.value.toFixed(2)} A`
);

const powerDisplay = computed(() => {
    const p = num(props.status?.power);
    return p === null ? EMPTY : `${p.toFixed(1)} W`;
});

const cyclesDisplay = computed(() => {
    const c = num(props.status?.cycles);
    return c === null ? EMPTY : String(c);
});

const resistanceDisplay = computed(() => {
    const r = num(props.status?.resistance_mohm);
    return r === null ? EMPTY : `${r.toFixed(1)} mΩ`;
});

/** Charging / discharging plus the device's own remaining-time estimate. */
const flowLabel = computed(() => {
    if (current.value === null || current.value === 0) return '';
    if (current.value > 0) return 'charging';
    const remaining = formatRemaining(num(props.status?.remaining_time));
    return remaining ? `${remaining} left` : 'discharging';
});

function formatRemaining(seconds: number | null): string {
    if (seconds === null || seconds <= 0) return '';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours >= 24) return `${Math.floor(hours / 24)} d`;
    if (hours > 0) return `${hours} h ${minutes} min`;
    return `${minutes} min`;
}

const chargedDisplay = computed(() => {
    const total = num(props.status?.energy_ch?.total);
    return total === null ? '' : total.toFixed(3);
});

const dischargedDisplay = computed(() => {
    const total = num(props.status?.energy_disch?.total);
    return total === null ? '' : total.toFixed(3);
});

const hasCounters = computed(
    () => chargedDisplay.value !== '' || dischargedDisplay.value !== ''
);

const packErrors = computed<string[]>(() => {
    const errors = props.status?.errors;
    return Array.isArray(errors) ? errors.map(String) : [];
});

/** `batteries` is keyed per channel (B1, B2, ...) — voltage, temperature, faults. */
const cells = computed(() => {
    const batteries = props.status?.batteries;
    if (!batteries || typeof batteries !== 'object') return [];
    return Object.entries(batteries as Record<string, any>).map(
        ([key, cell]) => {
            const voltage = num(cell?.voltage);
            const temperature = num(cell?.tC);
            const parts: string[] = [];
            if (voltage !== null) parts.push(`${voltage.toFixed(2)} V`);
            if (temperature !== null)
                parts.push(`${temperature.toFixed(1)}°C`);
            return {
                key,
                readout: parts.length ? parts.join(' · ') : EMPTY,
                errors: Array.isArray(cell?.errors)
                    ? cell.errors.map(String)
                    : []
            };
        }
    );
});

function humanError(code: string): string {
    const words = code.replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

function confirmResetCounters(): void {
    maintenanceConfirm.value?.storeAction(() => emit('resetCounters'), {
        title: 'Reset energy counters?',
        message:
            'The charged and drawn Amp-hour totals restart from zero on the device. This cannot be undone.',
        confirmLabel: 'Reset counters'
    });
}

function confirmResetCharge(): void {
    maintenanceConfirm.value?.storeAction(() => emit('resetCharge'), {
        title: 'Reset state of charge to 100%?',
        message:
            'Only do this with the battery actually full — the device treats the current level as 100% from now on. A restart may be required.',
        confirmLabel: 'Reset charge'
    });
}

function confirmReplaceBattery(): void {
    maintenanceConfirm.value?.storeAction(() => emit('replaceBattery'), {
        title: 'Mark the battery as replaced?',
        message:
            'Charge cycles reset to zero and the installation date restarts, so state-of-health history for the old pack is lost. This cannot be undone.',
        confirmLabel: 'Battery replaced'
    });
}
</script>

<style src="./entityTemplate.css"></style>
<style scoped>
.et-bm__note {
    color: var(--color-text-secondary);
}
.et-bm__cell-fault {
    color: var(--color-danger-text, var(--color-danger));
    margin-left: var(--space-2);
}
</style>

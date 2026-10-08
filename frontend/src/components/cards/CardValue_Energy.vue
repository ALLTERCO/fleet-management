<template>
    <!-- 1×1: hero value + separator + V/A/PF metrics -->
    <CardShell
        v-if="size === '1x1'"
        :type="cardType"
        :name="entity.name"
        icon="fas fa-bolt"
        size="1x1"
        val-class="ec-val--flush"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <!-- em3 (3-phase): total + phase sub-values -->
            <div v-if="cardType === 'em3'" class="em-layout">
                <div class="em-hero">
                    <span class="em-hero-v">{{ powerDisplay }}</span>
                    <span class="ec-u">{{ powerUnit }}</span>
                </div>
                <div class="em-sep"></div>
                <div class="em-metrics">
                    <template v-for="ph in phases" :key="ph.name">
                        <div v-if="ph.power" class="em-cell">
                            <div class="em-cell-l" :class="ph.headerClass">{{ ph.name }}</div>
                            <div class="em-cell-v">{{ ph.power.value }}<span class="ec-u ec-u--sm">{{ ph.power.unit }}</span></div>
                        </div>
                    </template>
                </div>
            </div>
            <!-- Single-phase -->
            <div v-else class="em-layout">
                <div class="em-hero">
                    <span class="em-hero-v">{{ powerDisplay }}</span>
                    <span class="ec-u">{{ powerUnit }}</span>
                </div>
                <div class="em-sep"></div>
                <div class="em-metrics">
                    <div v-if="hasMetric(voltageMetric)" class="em-cell"><div class="em-cell-l">V</div><div class="em-cell-v">{{ voltageMetric.value }}</div></div>
                    <div v-if="hasMetric(currentMetric)" class="em-cell"><div class="em-cell-l">A</div><div class="em-cell-v">{{ currentMetric.value }}</div></div>
                    <div v-if="hasMetric(pfMetric)" class="em-cell"><div class="em-cell-l">PF</div><div class="em-cell-v">{{ pfMetric.value }}</div></div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2×1: hero value + separator + metric cells -->
    <CardShell
        v-else-if="size === '2x1'"
        :type="cardType"
        :name="entity.name"
        icon="fas fa-bolt"
        size="2x1"
        val-class="ec-val--flush"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="em-layout">
                <div class="em-hero">
                    <span class="em-hero-v">{{ powerDisplay }}</span>
                    <span class="ec-u">{{ powerUnit }}</span>
                </div>
                <div class="em-sep"></div>
                <div class="em-metrics">
                    <div v-for="m in wideMetrics" :key="m.label" class="em-cell">
                        <div class="em-cell-l">{{ m.label }}</div>
                        <div class="em-cell-v">{{ m.value }}<span v-if="m.unit" class="ec-u ec-u--sm">{{ m.unit }}</span></div>
                    </div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2×2 energy: hero power + line-condition meter row + counter grid -->
    <CardShell
        v-else-if="cardType === 'energy'"
        :type="cardType"
        :name="entity.name"
        icon="fas fa-bolt"
        size="2x2"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div v-if="hasMetric(powerMetric)" class="ec-hero-power">
                <div class="ec-hero-power-v">{{ powerDisplay }}</div>
                <div class="ec-u">{{ powerUnit }}</div>
            </div>
            <div v-if="faultText" class="ec-em-fault s-fault">
                <i class="fas fa-triangle-exclamation" />{{ faultText }}
            </div>
            <!-- Live line conditions, same row the metered Switch 2×2 uses. -->
            <div v-if="hasHeroMeter" class="ec-hero-meter">
                <div v-if="hasMetric(voltageMetric)" class="ec-hero-meter-item"><span class="ec-hero-meter-v">{{ voltageMetric.value }}</span><span class="ec-u ec-u--sm">V</span></div>
                <div v-if="hasMetric(currentMetric)" class="ec-hero-meter-item"><span class="ec-hero-meter-v">{{ currentMetric.value }}</span><span class="ec-u ec-u--sm">A</span></div>
                <div v-if="hasMetric(pfMetric)" class="ec-hero-meter-item"><span class="ec-hero-meter-v">{{ pfMetric.value }}</span><span class="ec-u ec-u--sm">PF</span></div>
                <div v-if="hasMetric(freqMetric)" class="ec-hero-meter-item"><span class="ec-hero-meter-v">{{ freqMetric.value }}</span><span class="ec-u ec-u--sm">Hz</span></div>
            </div>
            <!-- Count drives columns and value size (see card-sensors.css). -->
            <div class="ec-hero-grid" :data-count="energyStats.length">
                <div v-for="s in energyStats" :key="s.key" class="ec-hero-grid-item">
                    <div class="ec-hero-grid-v">{{ s.value }}<span v-if="s.unit" class="ec-u ec-u--sm">{{ s.unit }}</span></div>
                    <div class="ec-hero-grid-l">{{ s.label }}</div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2×2 em3: hero head + phase grid with kVA + footer stats -->
    <CardShell
        v-else
        :type="cardType"
        :name="entity.name"
        icon="fas fa-bolt"
        size="2x2"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="ec-em-hero-head">
                <div class="ec-em-hero-inline"><span class="ec-em-hero-v">{{ powerDisplay }}</span><span class="ec-u">{{ powerUnit }}</span></div>
                <div v-if="energyDisplay" class="ec-em-hero-sub">{{ energyDisplay }} total energy</div>
            </div>
            <!-- Value and unit are separate cells so each column aligns. -->
            <div class="ec-ph-grid">
                <div v-for="ph in phases" :key="ph.name" class="ec-ph-col">
                    <div class="ec-ph-hdr" :class="ph.headerClass">{{ ph.name }}</div>
                    <template v-for="r in ph.rows" :key="r.key">
                        <span class="ec-ph-val">{{ r.value }}</span><span class="ec-ph-u ec-u ec-u--sm">{{ r.unit }}</span>
                    </template>
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
import {
    formatApparentPower,
    formatApparentPowerGroup,
    formatCurrent,
    formatEnergy,
    formatFrequency,
    formatPower,
    formatPowerFactor,
    formatPowerGroup,
    formatVoltage,
    hasMetric,
    type Metric,
    meterFaults,
    metricText
} from '@/helpers/powerMetrics';
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
const device = computed(() => deviceStore.devices[props.entity.source]);
const isOffline = computed(() => !device.value?.online);
const isSleeping = computed(() => !!device.value?.sleeping);

const status = computed(() => {
    if (!device.value) return null;
    const e = props.entity;
    return device.value.status?.[`${e.type}:${e.properties.id}`] ?? null;
});

// Detect 3-phase by checking for phase-prefixed fields in status (a_voltage, b_voltage, c_voltage)
const cardType = computed(() => {
    const s = status.value;
    if (s && s.a_voltage !== undefined && s.b_voltage !== undefined)
        return 'em3';
    return 'energy';
});

// Shared powerMetrics helpers: same rounding as every other surface, and an
// empty unit when a reading is absent so "— V" never renders as a real value.
const powerMetric = computed(() =>
    formatPower(
        status.value?.act_power ??
            status.value?.apower ??
            status.value?.total_act_power
    )
);
const voltageMetric = computed(() =>
    formatVoltage(status.value?.voltage ?? status.value?.a_voltage)
);
const currentMetric = computed(() =>
    formatCurrent(
        status.value?.current ??
            status.value?.a_current ??
            status.value?.total_current
    )
);
// em:0 has no top-level `freq`; frequency is common to all phases.
const freqMetric = computed(() =>
    formatFrequency(
        status.value?.freq ??
            status.value?.a_freq ??
            status.value?.b_freq ??
            status.value?.c_freq
    )
);
const pfMetric = computed(() =>
    formatPowerFactor(status.value?.pf ?? status.value?.a_pf)
);
// PM1 spells it `aprtpower`; EM1 uses `aprt_power`, em (3-phase) `total_aprt_power`.
const apparentMetric = computed(() =>
    formatApparentPower(
        status.value?.aprt_power ??
            status.value?.aprtpower ??
            status.value?.total_aprt_power
    )
);

const powerDisplay = computed(() => powerMetric.value.value);
const powerUnit = computed(() => powerMetric.value.unit);

// The meter row draws its own divider, so an all-empty row would leave a rule
// floating on nothing — hide the container, not just the cells.
const hasHeroMeter = computed(() =>
    [voltageMetric, currentMetric, pfMetric, freqMetric].some((m) =>
        hasMetric(m.value)
    )
);

// Energy data — may be in the same status key or in a separate em1data:N / emdata:N key
const energyStatus = computed(() => {
    if (!device.value) return null;
    const e = props.entity;
    const id = e.properties.id;
    // Try em1data:N (3EM monophase), emdata:N (3EM triphase), then inline in status
    return (
        device.value.status?.[`em1data:${id}`] ??
        device.value.status?.[`emdata:${id}`] ??
        status.value
    );
});

// EM1Data / EMData / PM1 each spell the lifetime counters differently.
const consumedMetric = computed(() =>
    formatEnergy(
        energyStatus.value?.total_act_energy ??
            energyStatus.value?.total_act ??
            status.value?.aenergy?.total
    )
);
const returnedMetric = computed(() =>
    formatEnergy(
        energyStatus.value?.total_act_ret_energy ??
            energyStatus.value?.total_act_ret ??
            status.value?.ret_aenergy?.total
    )
);

// One string, so the 13px em3 sub-line carries no separately sized unit.
const energyDisplay = computed<string | null>(() =>
    hasMetric(consumedMetric.value) ? metricText(consumedMetric.value) : null
);

// Apparent power and the two lifetime counters — the readings that need a word
// to be read. Anything the device does not report drops its cell.
const energyStats = computed(() =>
    [
        {key: 'apparent', label: 'Apparent', ...apparentMetric.value},
        {key: 'consumed', label: 'Consumed', ...consumedMetric.value},
        {key: 'returned', label: 'Returned', ...returnedMetric.value}
    ].filter(hasMetric)
);

// EM1/PM1 report faults on the meter, EM1Data/EMData on the counter store.
const faultText = computed<string | null>(() => {
    const faults = meterFaults(status.value, energyStatus.value);
    return faults.length > 0 ? faults.join(' · ') : null;
});

// Phases are compared, so power and apparent power are scaled as one group.
const PHASE_PREFIXES = ['a', 'b', 'c'] as const;

const phases = computed(() => {
    const s = status.value;
    const powers = formatPowerGroup(
        PHASE_PREFIXES.map((p) => s?.[`${p}_act_power`])
    );
    const apparents = formatApparentPowerGroup(
        PHASE_PREFIXES.map((p) => s?.[`${p}_aprt_power`])
    );
    // A phase the meter does not report drops its row — never "— V".
    return PHASE_PREFIXES.map((p, i) => {
        const readings: [string, Metric][] = [
            ['voltage', formatVoltage(s?.[`${p}_voltage`])],
            ['current', formatCurrent(s?.[`${p}_current`])],
            ['power', powers[i]],
            ['apparent', apparents[i]],
            // PF is dimensionless; the column labels it so the unit is literal.
            ['pf', {...formatPowerFactor(s?.[`${p}_pf`]), unit: 'PF'}]
        ];
        return {
            name: `Phase ${p.toUpperCase()}`,
            headerClass: `ec-ph-${p}`,
            // The 1x1 tile shows active power alone; null hides that phase cell.
            power: hasMetric(powers[i]) ? powers[i] : null,
            rows: readings
                .filter(([, m]) => hasMetric(m))
                .map(([key, m]) => ({key, value: m.value, unit: m.unit}))
        };
    }).filter((ph) => ph.rows.length > 0);
});

// 2×1 metric cells below the hero value — reported readings only. Apparent
// power is here too: a meter that reports VA must not lose it at this size.
const wideMetrics = computed(() =>
    [
        {label: 'Voltage', ...voltageMetric.value},
        {label: 'Current', ...currentMetric.value},
        {label: 'Apparent', ...apparentMetric.value},
        {label: 'PF', ...pfMetric.value},
        {label: 'Freq', ...freqMetric.value}
    ].filter((m) => hasMetric(m))
);
</script>

<style scoped>
/* ── Atomic energy card layout — self-contained, no parent dependency ── */
.em-layout {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
}
.em-hero {
    display: flex;
    align-items: baseline;
    justify-content: center;
    padding: var(--space-4);
    flex: 1;
}
/* Relative tracking: tightens the digits without eating their advance. */
.em-hero-v {
    font-variant-numeric: tabular-nums;
    font-size: var(--type-heading);
    font-weight: 800;
    letter-spacing: var(--tracking-tight);
    line-height: 1;
    color: var(--color-text-primary);
}
.em-sep {
    height: 1px;
    flex-shrink: 0;
    background: var(--color-border-default);
    margin: 0 var(--space-6);
}
.em-metrics {
    display: flex;
    flex: 1;
}
.em-cell {
    flex: 1;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 14px var(--space-1);
    position: relative;
}
.em-cell + .em-cell::before {
    content: "";
    position: absolute;
    left: 0;
    top: 25%;
    bottom: 25%;
    width: 1px;
    background: var(--color-border-default);
}
.em-cell-l {
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--color-text-quaternary);
    margin-bottom: var(--space-1);
}
.em-cell-l.ec-ph-a { color: var(--a-motion); }
.em-cell-l.ec-ph-b { color: var(--a-temp); }
.em-cell-l.ec-ph-c { color: var(--color-status-on); }
.em-cell-v {
    font-variant-numeric: tabular-nums;
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-secondary);
}
</style>

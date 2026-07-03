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
            <div v-if="cardType === 'em3'" class="em-layout em-layout--sm">
                <div class="em-hero">
                    <span class="em-hero-v">{{ powerDisplay }}</span>
                    <span class="em-hero-u">{{ powerUnit }}</span>
                </div>
                <div class="em-sep"></div>
                <div class="em-metrics">
                    <div class="em-cell">
                        <div class="em-cell-l ec-ph-a">Phase A</div>
                        <div class="em-cell-v">{{ phaseA.power }}<span class="em-cell-u">{{ phaseA.powerUnit }}</span></div>
                    </div>
                    <div class="em-cell">
                        <div class="em-cell-l ec-ph-b">Phase B</div>
                        <div class="em-cell-v">{{ phaseB.power }}<span class="em-cell-u">{{ phaseB.powerUnit }}</span></div>
                    </div>
                    <div class="em-cell">
                        <div class="em-cell-l ec-ph-c">Phase C</div>
                        <div class="em-cell-v">{{ phaseC.power }}<span class="em-cell-u">{{ phaseC.powerUnit }}</span></div>
                    </div>
                </div>
            </div>
            <!-- Single-phase -->
            <div v-else class="em-layout em-layout--sm">
                <div class="em-hero">
                    <span class="em-hero-v">{{ powerDisplay }}</span>
                    <span class="em-hero-u">{{ powerUnit }}</span>
                </div>
                <div class="em-sep"></div>
                <div class="em-metrics">
                    <div class="em-cell"><div class="em-cell-l">V</div><div class="em-cell-v">{{ voltageDisplay }}</div></div>
                    <div class="em-cell"><div class="em-cell-l">A</div><div class="em-cell-v">{{ currentDisplay }}</div></div>
                    <div class="em-cell"><div class="em-cell-l">PF</div><div class="em-cell-v">{{ pfDisplay }}</div></div>
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
                    <span class="em-hero-u">{{ powerUnit }}</span>
                </div>
                <div class="em-sep"></div>
                <div class="em-metrics">
                    <div v-for="m in wideMetrics" :key="m.label" class="em-cell">
                        <div class="em-cell-l">{{ m.label }}</div>
                        <div class="em-cell-v">{{ m.value }}<span v-if="m.unit" class="em-cell-u">{{ m.unit }}</span></div>
                    </div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2×2 energy: hero head + 2-col metric grid + Returned footer -->
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
            <div class="ec-em-hero-head">
                <div class="ec-em-hero-inline"><span class="ec-em-hero-v">{{ powerDisplay }}</span><span class="ec-em-hero-u">{{ powerUnit }}</span></div>
                <div class="ec-em-hero-sub">{{ energyDisplay }} kWh total energy</div>
            </div>
            <div class="ec-ph-grid ec-ph-grid--2">
                <div class="ec-ph-col">
                    <div class="ec-ph-hdr ec-ph-hdr--neutral">Voltage</div>
                    <div class="ec-ph-val">{{ voltageDisplay }} <span>V</span></div>
                    <div class="ec-ph-hdr ec-ph-hdr--neutral">Current</div>
                    <div class="ec-ph-val">{{ currentDisplay }} <span>A</span></div>
                </div>
                <div class="ec-ph-col">
                    <div class="ec-ph-hdr ec-ph-hdr--neutral">Frequency</div>
                    <div class="ec-ph-val">{{ freqDisplay }} <span>Hz</span></div>
                    <div class="ec-ph-hdr ec-ph-hdr--neutral">Power Factor</div>
                    <div class="ec-ph-val">{{ pfDisplay }} <span>PF</span></div>
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
                <div class="ec-em-hero-inline"><span class="ec-em-hero-v">{{ powerDisplay }}</span><span class="ec-em-hero-u">{{ powerUnit }}</span></div>
                <div class="ec-em-hero-sub">{{ energyDisplay }} kWh total energy</div>
            </div>
            <div class="ec-ph-grid">
                <div class="ec-ph-col">
                    <div class="ec-ph-hdr ec-ph-a">Phase A</div>
                    <div class="ec-ph-val">{{ phaseA.voltage }} <span>V</span></div>
                    <div class="ec-ph-val">{{ phaseA.current }} <span>A</span></div>
                    <div class="ec-ph-val">{{ phaseA.power }} <span>{{ phaseA.powerUnit }}</span></div>
                    <div class="ec-ph-val">{{ phaseA.apparent }} <span>{{ phaseA.apparentUnit }}</span></div>
                    <div class="ec-ph-val">{{ phaseA.pf }} <span>PF</span></div>
                </div>
                <div class="ec-ph-col">
                    <div class="ec-ph-hdr ec-ph-b">Phase B</div>
                    <div class="ec-ph-val">{{ phaseB.voltage }} <span>V</span></div>
                    <div class="ec-ph-val">{{ phaseB.current }} <span>A</span></div>
                    <div class="ec-ph-val">{{ phaseB.power }} <span>{{ phaseB.powerUnit }}</span></div>
                    <div class="ec-ph-val">{{ phaseB.apparent }} <span>{{ phaseB.apparentUnit }}</span></div>
                    <div class="ec-ph-val">{{ phaseB.pf }} <span>PF</span></div>
                </div>
                <div class="ec-ph-col">
                    <div class="ec-ph-hdr ec-ph-c">Phase C</div>
                    <div class="ec-ph-val">{{ phaseC.voltage }} <span>V</span></div>
                    <div class="ec-ph-val">{{ phaseC.current }} <span>A</span></div>
                    <div class="ec-ph-val">{{ phaseC.power }} <span>{{ phaseC.powerUnit }}</span></div>
                    <div class="ec-ph-val">{{ phaseC.apparent }} <span>{{ phaseC.apparentUnit }}</span></div>
                    <div class="ec-ph-val">{{ phaseC.pf }} <span>PF</span></div>
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

function formatPower(w: number | undefined | null): {
    display: string;
    unit: string;
} {
    if (w === undefined || w === null) return {display: '—', unit: 'W'};
    if (Math.abs(w) >= 1000)
        return {display: (w / 1000).toFixed(1), unit: 'kW'};
    return {display: String(Math.round(w)), unit: 'W'};
}

const powerDisplay = computed(() => {
    const w =
        status.value?.act_power ??
        status.value?.apower ??
        status.value?.total_act_power;
    return formatPower(w).display;
});

const powerUnit = computed(() => {
    const w =
        status.value?.act_power ??
        status.value?.apower ??
        status.value?.total_act_power;
    return formatPower(w).unit;
});

const voltageDisplay = computed(() => {
    const v = status.value?.voltage ?? status.value?.a_voltage;
    return v !== undefined && v !== null ? v.toFixed(1) : '—';
});

const currentDisplay = computed(() => {
    const a =
        status.value?.current ??
        status.value?.a_current ??
        status.value?.total_current;
    return a !== undefined && a !== null ? a.toFixed(2) : '—';
});

const freqDisplay = computed(() => {
    const f = status.value?.freq;
    return f !== undefined && f !== null ? f.toFixed(2) : '—';
});

const pfDisplay = computed(() => {
    const pf = status.value?.pf ?? status.value?.a_pf;
    return pf !== undefined && pf !== null ? pf.toFixed(2) : '—';
});

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

const energyDisplay = computed(() => {
    const total =
        energyStatus.value?.total_act_energy ??
        energyStatus.value?.total_act ??
        status.value?.aenergy?.total;
    if (total === undefined || total === null) return '—';
    return (total / 1000).toFixed(1);
});

// Per-phase data for em3 2×2
function getPhaseData(prefix: string) {
    return computed(() => {
        const s = status.value;
        if (!s)
            return {
                voltage: '—',
                current: '—',
                power: '—',
                powerUnit: 'kW',
                apparent: '—',
                apparentUnit: 'kVA',
                pf: '—'
            };
        const v = s[`${prefix}_voltage`];
        const a = s[`${prefix}_current`];
        const p = s[`${prefix}_act_power`];
        const ap = s[`${prefix}_aprt_power`];
        const pf = s[`${prefix}_pf`];
        const pw = p != null ? formatPower(p) : null;
        const apw = ap != null ? formatPower(ap) : null;
        return {
            voltage: v != null ? v.toFixed(1) : '—',
            current: a != null ? a.toFixed(2) : '—',
            power: pw?.display ?? '—',
            powerUnit: pw ? (pw.unit === 'kW' ? 'kW' : 'W') : 'kW',
            apparent: apw?.display ?? '—',
            apparentUnit: apw ? (apw.unit === 'kW' ? 'kVA' : 'VA') : 'kVA',
            pf: pf != null ? pf.toFixed(2) : '—'
        };
    });
}

const phaseA = getPhaseData('a');
const phaseB = getPhaseData('b');
const phaseC = getPhaseData('c');

// 2×1 metric cells below hero value (V, A, PF, Hz)
const wideMetrics = computed(() => [
    {value: voltageDisplay.value, label: 'Voltage', unit: 'V'},
    {value: currentDisplay.value, label: 'Current', unit: 'A'},
    {value: pfDisplay.value, label: 'PF', unit: ''},
    {value: freqDisplay.value, label: 'Freq', unit: 'Hz'}
]);
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
    gap: var(--space-1);
    padding: var(--space-4);
    flex: 1;
}
.em-hero-v {
    font-variant-numeric: tabular-nums;
    font-size: var(--type-body);
    font-weight: 800;
    letter-spacing: -3px;
    line-height: 1;
    color: var(--color-text-primary);
}
.em-hero-u {
    font-size: var(--type-subheading);
    font-weight: 600;
    color: var(--color-text-tertiary);
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
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-quaternary);
    margin-bottom: var(--space-1);
}
.em-cell-l.ec-ph-a { color: var(--a-motion); }
.em-cell-l.ec-ph-b { color: var(--a-temp); }
.em-cell-l.ec-ph-c { color: var(--color-status-on); }
.em-cell-v {
    font-variant-numeric: tabular-nums;
    font-size: var(--type-subheading);
    font-weight: 700;
    color: var(--color-text-secondary);
}
.em-cell-u {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-quaternary);
    margin-left: var(--space-0-5);
}

/* 1×1 — only font size overrides */
.em-layout--sm .em-hero-v { font-size: var(--type-body); letter-spacing: -2px; }
.em-layout--sm .em-hero-u { font-size: var(--type-subheading); }
.em-layout--sm .em-cell-v { font-size: var(--type-body); }
</style>

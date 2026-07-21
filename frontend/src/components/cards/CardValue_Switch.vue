<template>
    <!-- ═══ 1×1 PM: compact power + toggle ═══ -->
    <CardShell
        v-if="size === '1x1' && hasPM"
        type="switch"
        :name="entity.name"
        icon="fas fa-power-off"
        size="1x1"
        :is-on="isOn"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        :allowed-sizes="allowedSizes"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
        @resize="(s: string) => $emit('resize', s)"
    >
        <template #default>
            <div class="ec-hv-wrap">
                <span class="ec-hv">{{ powerDisplay }}</span>
                <span class="ec-hu">{{ powerUnit }}</span>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
        <template #toggle>
            <CardToggle :is-on="isThermostatActuator ? thermostatEnabled : isOn" :disabled="!canToggle" @toggle="toggle" />
        </template>
    </CardShell>

    <!-- ═══ 1×1 thermostat actuator (no PM): show thermostat state + toggle ═══ -->
    <CardShell
        v-else-if="size === '1x1' && isThermostatActuator"
        type="switch"
        :name="entity.name"
        icon="fas fa-power-off"
        size="1x1"
        :is-on="isOn"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        :allowed-sizes="allowedSizes"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
        @resize="(s: string) => $emit('resize', s)"
    >
        <template #default>
            <div class="ec-thermo-badge">
                <i class="fas fa-temperature-half" />
                <span>{{ thermostatEnabled ? 'Heating' : 'Standby' }}</span>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
        <template #toggle>
            <CardToggle :is-on="thermostatEnabled" :disabled="!canToggle" @toggle="toggle" />
        </template>
    </CardShell>

    <!-- ═══ 1×1 no-PM: toggle-only ═══ -->
    <CardShell
        v-else-if="size === '1x1'"
        type="switch"
        :name="entity.name"
        icon="fas fa-power-off"
        size="1x1"
        :is-on="isOn"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        :allowed-sizes="allowedSizes"
        val-class="ec-val--toggle-only"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
        @resize="(s: string) => $emit('resize', s)"
    >
        <template #default>
            <CardToggle :is-on="isOn" :disabled="!canToggle" @toggle="toggle" />
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- ═══ 2×1 PM: left power (divided) + right metrics grid + toggle ═══ -->
    <CardShell
        v-else-if="size === '2x1' && hasPM"
        type="switch"
        :name="entity.name"
        icon="fas fa-power-off"
        size="2x1"
        :is-on="isOn"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        :allowed-sizes="allowedSizes"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
        @resize="(s: string) => $emit('resize', s)"
    >
        <template #default>
            <div class="ec-wide-row">
                <div class="ec-wl ec-wl--divided">
                    <div class="ec-hv-wrap">
                        <span class="ec-hv">{{ powerDisplay }}</span>
                        <span class="ec-hu">{{ powerUnit }}</span>
                    </div>
                </div>
                <div class="ec-wr">
                    <div class="ec-metrics-grid">
                        <div class="ec-metric"><span class="ec-metric-v">{{ voltageDisplay }}</span><span class="ec-metric-u">V</span></div>
                        <div class="ec-metric"><span class="ec-metric-v">{{ currentDisplay }}</span><span class="ec-metric-u">A</span></div>
                        <div class="ec-metric"><span class="ec-metric-v">{{ freqDisplay }}</span><span class="ec-metric-u">Hz</span></div>
                        <div class="ec-metric"><span class="ec-metric-v">{{ tempValueOnly }}</span><span class="ec-metric-u">°C</span></div>
                    </div>
                    <CardToggle class="ec-wr-toggle" :is-on="isThermostatActuator ? thermostatEnabled : isOn" :disabled="!canToggle" @toggle="toggle" />
                </div>
            </div>
            <div v-if="isThermostatActuator" class="ec-thermo-inline"><i class="fas fa-temperature-half" /> Thermostat relay</div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- ═══ 2×1 no-PM: stats row + toggle (the toggle shows state, so no
         redundant big ON/OFF text) + wiring line ═══ -->
    <CardShell
        v-else-if="size === '2x1'"
        type="switch"
        :name="entity.name"
        icon="fas fa-power-off"
        size="2x1"
        :is-on="isOn"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        :allowed-sizes="allowedSizes"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
        @resize="(s: string) => $emit('resize', s)"
    >
        <template #default>
            <div class="ec-relay-2x1">
                <div class="ec-relay-info">
                    <div v-for="s in relayStats" :key="s.key" class="ec-relay-row">
                        <span class="ec-relay-row-l">{{ s.label }}</span>
                        <span class="ec-relay-row-v">{{ s.value }}</span>
                    </div>
                    <div v-if="isThermostatActuator" class="ec-relay-row ec-relay-row--wiring">
                        <span class="ec-relay-row-l">Mode</span>
                        <span class="ec-relay-row-v">Thermostat</span>
                    </div>
                    <div v-else-if="relayModeLabel" class="ec-relay-row ec-relay-row--wiring">
                        <span class="ec-relay-row-l">Mode</span>
                        <span class="ec-relay-row-v">{{ relayModeLabel }}</span>
                    </div>
                </div>
                <CardToggle :is-on="isThermostatActuator ? thermostatEnabled : isOn" :disabled="!canToggle" @toggle="toggle" />
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- ═══ 2×2 PM: hero power + meter + toggle + stats grid ═══ -->
    <CardShell
        v-else-if="hasPM"
        type="switch"
        :name="entity.name"
        icon="fas fa-power-off"
        size="2x2"
        :is-on="isOn"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        :allowed-sizes="allowedSizes"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
        @resize="(s: string) => $emit('resize', s)"
    >
        <template #default>
            <!-- Big power value -->
            <div class="ec-hero-power">
                <div class="ec-hero-power-v">{{ powerDisplay }}</div>
                <div class="ec-hero-power-u">{{ powerUnit }}</div>
            </div>
            <!-- Electrical metrics row -->
            <div class="ec-hero-meter">
                <div class="ec-hero-meter-item"><span class="ec-hero-meter-v">{{ voltageDisplay }}</span><span class="ec-hero-meter-u">V</span></div>
                <div class="ec-hero-meter-item"><span class="ec-hero-meter-v">{{ currentDisplay }}</span><span class="ec-hero-meter-u">A</span></div>
                <div v-if="hasPf" class="ec-hero-meter-item"><span class="ec-hero-meter-v">{{ pfDisplay }}</span><span class="ec-hero-meter-u">PF</span></div>
                <div class="ec-hero-meter-item"><span class="ec-hero-meter-v">{{ freqDisplay }}</span><span class="ec-hero-meter-u">Hz</span></div>
            </div>
            <!-- Toggle -->
            <div class="ec-btn-zone" style="padding:0 var(--space-5)">
                <CardToggle :is-on="isThermostatActuator ? thermostatEnabled : isOn" :disabled="!canToggle" @toggle="toggle" />
                <div v-if="isThermostatActuator" class="ec-thermo-inline ec-thermo-inline--hero"><i class="fas fa-temperature-half" /> Thermostat relay</div>
            </div>
            <!-- Stats grid — only metrics the device reports; count drives the
                 columns, value size and spacing (see card-sensors.css). -->
            <div class="ec-hero-grid" :data-count="gridStats.length">
                <div v-for="s in gridStats" :key="s.key" class="ec-hero-grid-item">
                    <div class="ec-hero-grid-v">{{ s.text }}</div>
                    <div class="ec-hero-grid-l">{{ s.label }}</div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- ═══ 2×2 no-PM: state + toggle + info stats ═══ -->
    <CardShell
        v-else
        type="switch"
        :name="entity.name"
        icon="fas fa-power-off"
        size="2x2"
        :is-on="isOn"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        :allowed-sizes="allowedSizes"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
        @resize="(s: string) => $emit('resize', s)"
    >
        <template #default>
            <div class="ec-hero-top">
                <div class="ec-hero-top-v" :class="isOn ? 's-on' : 's-off'">{{ isOn ? 'ON' : 'OFF' }}</div>
                <div class="ec-hero-top-u">{{ entity.source }}</div>
            </div>
            <!-- Toggle -->
            <div class="ec-btn-zone" style="padding:0 var(--space-5)">
                <CardToggle :is-on="isThermostatActuator ? thermostatEnabled : isOn" :disabled="!canToggle" @toggle="toggle" />
                <div v-if="isThermostatActuator" class="ec-thermo-inline ec-thermo-inline--hero"><i class="fas fa-temperature-half" /> Thermostat relay</div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
        <template #footer>
            <div class="ec-hero-info">
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ isOn ? 'On' : 'Off' }}</div>
                    <div class="ec-hero-stat-l">Status</div>
                </div>
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ uptimeDisplay }}</div>
                    <div class="ec-hero-stat-l">Uptime</div>
                </div>
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ tempDisplay }}</div>
                    <div class="ec-hero-stat-l">Device Temp</div>
                </div>
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ rssiDisplay }}</div>
                    <div class="ec-hero-stat-l">RSSI</div>
                </div>
            </div>
        </template>
    </CardShell>
</template>

<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue';
import {useCardRpc} from '@/composables/useCardRpc';
import {
    formatCurrent,
    formatEnergy,
    formatFrequency,
    formatPower,
    formatPowerFactor,
    formatTemperature,
    formatVoltage,
    metricText
} from '@/helpers/powerMetrics';
import {allowedSizesForEntity} from '@/helpers/widgetCatalog';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import {loadDailyEnergy} from '@/tools/dailyEnergyLoader';
import type {entity_t} from '@/types';
import CardBadges from './CardBadges.vue';
import CardShell from './CardShell.vue';
import CardToggle from './CardToggle.vue';

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
    resize: [size: string];
}>();

const deviceStore = useDevicesStore();
const authStore = useAuthStore();
const rpc = useCardRpc();

const device = computed(() => deviceStore.devices[props.entity.source]);
const isOffline = computed(() => !device.value?.online);
const isSleeping = computed(() => !!device.value?.sleeping);
const canExecute = computed(() =>
    authStore.canExecuteDevice(props.entity.source)
);
// Gate on reachability too: an offline relay can't take the command, so the
// toggle disables instead of accepting a tap that goes nowhere.
const canToggle = computed(() => canExecute.value && !isOffline.value);

// A dry-contact relay (no power metering) caps at 1x1/2x1 — nothing fills a 2x2.
const allowedSizes = computed(() => allowedSizesForEntity(props.entity));

const status = computed(() => {
    if (!device.value) return null;
    return (
        deviceStore.statusOf(
            props.entity.source,
            `switch:${props.entity.properties.id}`
        ) ?? null
    );
});

const isOn = computed(() => !!status.value?.output);
const hasPM = computed(() => status.value?.apower !== undefined);

// Every electrical reading goes through the shared display standard
// (powerMetrics.ts) so every card reads the same.
const powerDisplay = computed(() => formatPower(status.value?.apower).value);
const powerUnit = computed(() => formatPower(status.value?.apower).unit);
const voltageDisplay = computed(
    () => formatVoltage(status.value?.voltage).value
);
const currentDisplay = computed(
    () => formatCurrent(status.value?.current).value
);
const freqDisplay = computed(() => formatFrequency(status.value?.freq).value);
const pfDisplay = computed(() => formatPowerFactor(status.value?.pf).value);
// Hide PF entirely when the device doesn't report it — no dash placeholder.
const hasPf = computed(() => typeof status.value?.pf === 'number');

// today/yesterday are the real daily figures from the 1-day rollup (batched
// loader — one query per board). Lifetime "Total" lives on the detail page,
// not the tile — matches how every dashboard handles cumulative counters.
const dailyEnergy = ref<{today: number; yesterday: number} | null>(null);
async function fetchDailyEnergy() {
    if (!hasPM.value || props.size !== '2x2') return;
    try {
        dailyEnergy.value = await loadDailyEnergy(props.entity.source);
    } catch {
        /* device may not have energy data yet */
    }
}
onMounted(fetchDailyEnergy);

const today = computed(() =>
    formatEnergy(dailyEnergy.value ? dailyEnergy.value.today * 1000 : null)
);
const yesterday = computed(() =>
    formatEnergy(dailyEnergy.value ? dailyEnergy.value.yesterday * 1000 : null)
);

// Device temperature lives on the switch component (switch:N.temperature.tC),
// not sys — sys is kept only as a fallback for devices that report it there.
const tempValueOnly = computed(() => {
    const switchTemp = (
        status.value as {temperature?: {tC?: number}} | null
    )?.temperature?.tC;
    const sysTemp = (
        device.value?.status?.sys as {temperature?: {tC?: number}} | undefined
    )?.temperature?.tC;
    return formatTemperature(switchTemp ?? sysTemp).value;
});
const tempDisplay = computed(() => {
    const t = tempValueOnly.value;
    return t === '—' ? '—' : `${t}°C`;
});

const rssiValueOnly = computed(() => {
    const wifi = device.value?.status?.wifi as {rssi?: number} | undefined;
    const rssi = wifi?.rssi;
    return rssi !== undefined && rssi !== null ? String(rssi) : '—';
});

const rssiDisplay = computed(() => {
    const rssi = rssiValueOnly.value;
    return rssi === '—' ? '—' : `${rssi} dBm`;
});

const uptimeDisplay = computed(() => {
    const sys = device.value?.status?.sys as {uptime?: number} | undefined;
    const uptime = sys?.uptime;
    if (uptime === undefined || uptime === null) return '—';
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
    return `${h}h ${m}m`;
});

// Physical input state (input:N.state) — the one useful reading on a non-metered
// relay, especially one wired to follow its switch. Absent → not shown.
const inputDisplay = computed<string | null>(() => {
    const inp = device.value?.status?.[
        `input:${props.entity.properties.id}`
    ] as {state?: boolean} | undefined;
    if (typeof inp?.state !== 'boolean') return null;
    return inp.state ? 'Closed' : 'Open';
});

// Non-PM relay stats — only what the device actually reports (no channel, no
// missing RSSI). Each has a plain label so it reads as "Input: Open", not a
// cryptic reading. Most-useful first; each tile takes as many as it has room for.
const relayStats = computed<{key: string; value: string; label: string}[]>(
    () => {
        const out: {key: string; value: string; label: string}[] = [];
        if (inputDisplay.value)
            out.push({key: 'input', value: inputDisplay.value, label: 'Input'});
        if (tempValueOnly.value !== '—')
            out.push({
                key: 'temp',
                value: `${tempValueOnly.value}°C`,
                label: 'Temp'
            });
        if (uptimeDisplay.value !== '—')
            out.push({
                key: 'uptime',
                value: uptimeDisplay.value,
                label: 'Uptime'
            });
        return out;
    }
);

// How the relay is wired to its physical input (settings.switch:N.in_mode),
// shown as a plain line so a glance tells you whether it tracks the wall switch.
// Input mode → the friendly names the Shelly app uses (Switch.SetConfig in_mode).
const RELAY_MODE_LABELS: Record<string, string> = {
    follow: 'Toggle',
    flip: 'Edge',
    momentary: 'Momentary',
    detached: 'Detached',
    activate: 'Activation',
    cycle: 'Cycle'
};
const relayModeLabel = computed<string | null>(() => {
    const cfg = device.value?.settings?.[
        `switch:${props.entity.properties.id}`
    ] as {in_mode?: string} | undefined;
    return cfg?.in_mode ? (RELAY_MODE_LABELS[cfg.in_mode] ?? null) : null;
});

// The 2x2 tile shows only stats the device actually reports — a glance value
// (today usage) plus device health. Missing metrics (e.g. temp on a device
// that has no sensor) are dropped, not shown as "—". PF and live V/A/Hz stay
// in the top meter row; Total lives on the detail page.
interface GridStat {
    key: string;
    label: string;
    text: string;
}
const gridStats = computed<GridStat[]>(() => {
    const out: GridStat[] = [];
    if (dailyEnergy.value) {
        out.push({key: 'today', label: 'Today', text: metricText(today.value)});
        out.push({
            key: 'yesterday',
            label: 'Yesterday',
            text: metricText(yesterday.value)
        });
    }
    if (uptimeDisplay.value !== '—')
        out.push({key: 'uptime', label: 'Uptime', text: uptimeDisplay.value});
    if (tempValueOnly.value !== '—')
        out.push({key: 'temp', label: 'Temp', text: tempDisplay.value});
    return out;
});
// Thermostat actuator: toggle targets the sibling thermostat entity because
// the relay rejects direct Switch.Toggle with error -109 in this mode
const thermostatActuatorId = computed(
    () =>
        (props.entity.properties as any)?.thermostatActuator as
            | number
            | undefined
);
const isThermostatActuator = computed(() => thermostatActuatorId.value != null);
const thermostatEnabled = computed(() => {
    if (thermostatActuatorId.value == null) return false;
    return !!device.value?.status?.[`thermostat:${thermostatActuatorId.value}`]
        ?.enable;
});

function toggle() {
    if (thermostatActuatorId.value != null) {
        const tid = thermostatActuatorId.value;
        const enabled =
            !!device.value?.status?.[`thermostat:${tid}`]?.enable;
        // Thermostat actuator lives on a sibling thermostat entity — compose its id
        const thermostatEntityId = `${props.entity.source}_${tid}:thermostat`;
        rpc.invokeAction(thermostatEntityId, 'setEnabled', {enabled: !enabled});
        return;
    }
    rpc.invokeAction(props.entity.id, 'setOutput', {on: !isOn.value});
}
</script>

<style scoped>
/* Thermostat actuator indicators */
.ec-thermo-badge {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.ec-thermo-badge i {
    font-size: var(--type-body);
    color: var(--color-warning-text);
    opacity: 0.7;
}
.ec-thermo-inline {
    font-size: var(--type-body);
    color: var(--color-text-quaternary);
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) 0 0 var(--space-5);
}
.ec-thermo-inline i {
    font-size: var(--icon-size-2xs); /* icon-only */
    color: var(--color-warning-text);
    opacity: 0.7;
}
.ec-thermo-inline--hero {
    justify-content: center;
    padding-left: 0;
    margin-top: var(--space-1);
}
/* 2x1 toggle sits a little higher, closer to the metrics above it. */
.ec-wr-toggle {
    margin-top: calc(var(--space-2) * -1);
}
/* Non-metered relay 2x1: a left-aligned info panel (label/value rows) with the
   toggle beside it. The toggle shows ON/OFF, so no big state text is needed. */
.ec-relay-2x1 {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: 0 var(--space-5);
    min-height: 0;
}
.ec-relay-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    min-width: 0;
}
.ec-relay-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
}
.ec-relay-row-l {
    flex-shrink: 0;
    width: 58px;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}
.ec-relay-row-v {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
/* Wiring row reads as quiet context, not a hard reading. */
.ec-relay-row--wiring .ec-relay-row-v {
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
}
/* 2x2 metered stats grid (Today/Yesterday/Uptime/Temp) nudged up off the
   pinned card name. */
.ec-hero-grid {
    transform: translateY(calc(-1 * var(--space-2)));
    row-gap: var(--space-2);
}
</style>

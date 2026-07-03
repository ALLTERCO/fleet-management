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
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
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
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
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
        val-class="ec-val--toggle-only"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
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
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
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
                    <CardToggle :is-on="isThermostatActuator ? thermostatEnabled : isOn" :disabled="!canToggle" @toggle="toggle" />
                </div>
            </div>
            <div v-if="isThermostatActuator" class="ec-thermo-inline"><i class="fas fa-temperature-half" /> Thermostat relay</div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- ═══ 2×1 no-PM: left state + right device info grid ═══ -->
    <CardShell
        v-else-if="size === '2x1'"
        type="switch"
        :name="entity.name"
        icon="fas fa-power-off"
        size="2x1"
        :is-on="isOn"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="ec-wide-row">
                <div class="ec-wl ec-wl--divided">
                    <div class="ec-hv-wrap">
                        <span class="ec-hv" :class="isOn ? 'ec-hv--state-on' : 'ec-hv--state-off'">{{ isOn ? 'ON' : 'OFF' }}</span>
                    </div>
                </div>
                <div class="ec-wr">
                    <div class="ec-metrics-grid">
                        <div class="ec-metric"><span class="ec-metric-v">{{ uptimeDisplay }}</span><span class="ec-metric-u">uptime</span></div>
                        <div class="ec-metric"><span class="ec-metric-v">{{ tempValueOnly }}</span><span class="ec-metric-u">°C</span></div>
                        <div class="ec-metric"><span class="ec-metric-v">{{ rssiValueOnly }}</span><span class="ec-metric-u">dBm</span></div>
                        <div class="ec-metric"><span class="ec-metric-v">{{ entity.properties.id }}</span><span class="ec-metric-u">ch</span></div>
                    </div>
                    <CardToggle :is-on="isThermostatActuator ? thermostatEnabled : isOn" :disabled="!canToggle" @toggle="toggle" />
                </div>
            </div>
            <div v-if="isThermostatActuator" class="ec-thermo-inline"><i class="fas fa-temperature-half" /> Thermostat relay</div>
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
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
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
                <div class="ec-hero-meter-item"><span class="ec-hero-meter-v">{{ pfDisplay }}</span><span class="ec-hero-meter-u">PF</span></div>
                <div class="ec-hero-meter-item"><span class="ec-hero-meter-v">{{ freqDisplay }}</span><span class="ec-hero-meter-u">Hz</span></div>
            </div>
            <!-- Toggle -->
            <div class="ec-btn-zone" style="padding:0 var(--space-5)">
                <CardToggle :is-on="isThermostatActuator ? thermostatEnabled : isOn" :disabled="!canToggle" @toggle="toggle" />
                <div v-if="isThermostatActuator" class="ec-thermo-inline ec-thermo-inline--hero"><i class="fas fa-temperature-half" /> Thermostat relay</div>
            </div>
            <!-- Stats grid — 3×2 -->
            <div class="ec-hero-grid">
                <div class="ec-hero-grid-item"><div class="ec-hero-grid-v">{{ todayEnergyDisplay }}</div><div class="ec-hero-grid-l">kWh Today</div></div>
                <div class="ec-hero-grid-item"><div class="ec-hero-grid-v">{{ yesterdayEnergyDisplay }}</div><div class="ec-hero-grid-l">kWh Yesterday</div></div>
                <div class="ec-hero-grid-item"><div class="ec-hero-grid-v">{{ energyDisplay }}</div><div class="ec-hero-grid-l">kWh Total</div></div>
                <div class="ec-hero-grid-item"><div class="ec-hero-grid-v">{{ uptimeDisplay }}</div><div class="ec-hero-grid-l">Uptime</div></div>
                <div class="ec-hero-grid-item"><div class="ec-hero-grid-v">{{ tempDisplay }}</div><div class="ec-hero-grid-l">Temp</div></div>
                <div class="ec-hero-grid-item"><div class="ec-hero-grid-v">{{ pfDisplay }}</div><div class="ec-hero-grid-l">Power Factor</div></div>
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
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
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
const canToggle = computed(() => canExecute.value);

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

// Power display — format W or kW
const powerDisplay = computed(() => {
    const w = status.value?.apower ?? 0;
    return w >= 1000 ? (w / 1000).toFixed(1) : String(Math.round(w));
});
const powerUnit = computed(() => {
    const w = status.value?.apower ?? 0;
    return w >= 1000 ? 'kW' : 'W';
});

const voltageDisplay = computed(() => {
    const v = status.value?.voltage;
    return v != null ? v.toFixed(1) : '—';
});

const currentDisplay = computed(() => {
    const a = status.value?.current;
    return a != null ? a.toFixed(2) : '—';
});

const freqDisplay = computed(() => {
    const f = status.value?.freq;
    return f != null ? f.toFixed(2) : '—';
});

const pfDisplay = computed(() => {
    const pf = status.value?.pf;
    return pf != null ? pf.toFixed(2) : '—';
});

const energyDisplay = computed(() => {
    const total = status.value?.aenergy?.total;
    if (total == null) return '—';
    return (total / 1000).toFixed(1);
});

// Daily energy via the batched loader — every visible switch card is
// coalesced into one energy.query reading the 1-day rollup, so opening a
// dashboard stays one round trip regardless of device count.
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

const todayEnergyDisplay = computed(() => {
    if (!dailyEnergy.value) return '—';
    const kwh = dailyEnergy.value.today;
    return kwh >= 1 ? kwh.toFixed(1) : kwh.toFixed(3);
});

const yesterdayEnergyDisplay = computed(() => {
    if (!dailyEnergy.value) return '—';
    const kwh = dailyEnergy.value.yesterday;
    return kwh >= 1 ? kwh.toFixed(1) : kwh.toFixed(3);
});

const tempValueOnly = computed(() => {
    const sys = device.value?.status?.sys as
        | {temperature?: {tC?: number}}
        | undefined;
    const tC = sys?.temperature?.tC;
    return tC !== undefined && tC !== null ? tC.toFixed(1) : '—';
});

const tempDisplay = computed(() => {
    const v = tempValueOnly.value;
    return v === '—' ? '—' : `${v}°C`;
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
    rpc.invokeAction(props.entity.id, 'toggle');
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
</style>

<template>
    <!-- 1×1: dual target/current + state label -->
    <CardShell
        v-if="size === '1x1'"
        type="trv"
        :name="entity.name"
        :icon="isBluTrv ? 'fas fa-pipe-valve' : 'fas fa-temperature-arrow-up'"
        size="1x1"
        :is-on="isHeating"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="ec-dual">
                <div class="ec-dual-item">
                    <div class="ec-dv">{{ targetDisplay }}°</div>
                    <div class="ec-dl">Target</div>
                </div>
                <div class="ec-dsep" />
                <div class="ec-dual-item">
                    <div class="ec-dv">{{ currentDisplay }}°</div>
                    <div class="ec-dl">Current</div>
                </div>
            </div>
            <!-- State indicator: flame (heating), dash (idle), power (off) -->
            <div v-if="isEnabled" class="ec-trv-state-row">
                <svg v-if="isHeating" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-status-warn)" stroke-width="2"><path d="M12 2c0 6-6 6-6 12a6 6 0 0012 0c0-6-6-6-6-12z"/></svg>
                <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-quaternary)" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                <span :style="{fontSize:'11px',fontWeight:700,color: isHeating ? 'var(--color-status-warn)' : 'var(--color-text-quaternary)'}">{{ stateLabel }}</span>
            </div>
            <div v-else class="ec-trv-state-row">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-quaternary)" stroke-width="2"><path d="M18.36 6.64A9 9 0 1 1 5.64 6.64"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
                <span class="ec-trv-state-label">OFF</span>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :battery="isBluTrv ? batteryLevel : null" :shelly-id="entity.source" />
        </template>
        <template v-if="!isBluTrv" #toggle>
            <CardToggle :is-on="isEnabled" :disabled="!canExecute" @toggle="toggleEnable" />
        </template>
    </CardShell>

    <!-- 2×1: big target + current + presets + modes + adjust -->
    <CardShell
        v-else-if="size === '2x1'"
        type="trv"
        :name="entity.name"
        :icon="isBluTrv ? 'fas fa-pipe-valve' : 'fas fa-temperature-arrow-up'"
        size="2x1"
        :is-on="isHeating"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="ec-wide-row">
                <div class="ec-wl">
                    <div class="ec-trv-target">{{ targetDisplay }}<span>°</span></div>
                    <div class="ec-trv-cur-sm">{{ currentDisplay }}° current</div>
                    <div class="ec-trv-state-row--inline">
                        <svg v-if="isHeating" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-status-warn)" stroke-width="2"><path d="M12 2c0 6-6 6-6 12a6 6 0 0012 0c0-6-6-6-6-12z"/></svg>
                        <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-quaternary)" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        <span :style="{fontSize:'10px',fontWeight:700,color: isHeating ? 'var(--color-status-warn)' : 'var(--color-text-quaternary)'}">{{ stateLabel }}</span>
                        <span v-if="isBluTrv && valvePercent != null" class="ec-trv-valve-label">Valve {{ valveDisplay }}%</span>
                    </div>
                </div>
                <div class="ec-wr">
                    <div class="ec-temps">
                        <button
                            v-for="p in widePresets"
                            :key="p"
                            class="ec-tv"
                            :class="{act: target === p}"
                            :disabled="!canExecute"
                            @click.stop="setTarget(p)"
                        >{{ p }}°</button>
                    </div>
                    <div v-if="!isBluTrv" class="ec-modes">
                        <button class="ec-mode" :class="{act: !isEnabled}" :disabled="!canExecute" @click.stop="toggleEnable">Off</button>
                        <button class="ec-mode" :class="{act: isEnabled}" :disabled="!canExecute" @click.stop="setModeHeat">Heat</button>
                    </div>
                    <div class="ec-adj">
                        <button
                            class="ec-adj-btn"
                            :disabled="!canExecute"
                            aria-label="Decrease temperature"
                            @click.stop="adjustTarget(-0.5)"
                        ><i class="fas fa-minus" /></button>
                        <button
                            class="ec-adj-btn"
                            :disabled="!canExecute"
                            aria-label="Increase temperature"
                            @click.stop="adjustTarget(0.5)"
                        ><i class="fas fa-plus" /></button>
                    </div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :battery="isBluTrv ? batteryLevel : null" :shelly-id="entity.source" />
        </template>
        <template v-if="!isBluTrv" #toggle>
            <CardToggle :is-on="isEnabled" :disabled="!canExecute" @toggle="toggleEnable" />
        </template>
    </CardShell>

    <!-- 2×2: hero temps + controls zone -->
    <CardShell
        v-else
        type="trv"
        :name="entity.name"
        :icon="isBluTrv ? 'fas fa-pipe-valve' : 'fas fa-temperature-arrow-up'"
        size="2x2"
        :is-on="isHeating"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <!-- Hero temps: big SET + smaller NOW -->
            <div class="ec-trv-hero-temps">
                <div class="ec-trv-hero-set">
                    <div class="ec-trv-hero-set-v">{{ targetDisplay }}<span>°</span></div>
                    <div class="ec-trv-hero-set-l">TARGET</div>
                </div>
                <div class="ec-trv-hero-now">
                    <div class="ec-trv-hero-now-v">{{ currentDisplay }}<span>°</span></div>
                    <div class="ec-trv-hero-now-l">CURRENT</div>
                </div>
            </div>

            <!-- Controls zone -->
            <div class="ec-trv-hero-controls">
                <!-- Valve position bar (BluTrv only) -->
                <div v-if="isBluTrv" class="ec-trv-valve-row">
                    <div class="ec-trv-valve-label">Valve</div>
                    <div class="ec-trv-valve-bar">
                        <div class="ec-trv-valve-fill" :style="{width: (valvePercent ?? 0) + '%'}" />
                    </div>
                    <div class="ec-trv-valve-pct">{{ valveDisplay }}%</div>
                </div>

                <!-- Temperature presets -->
                <div class="ec-trv-presets">
                    <button
                        v-for="p in heroPresets"
                        :key="p"
                        class="ec-tv"
                        :class="{act: target === p}"
                        :disabled="!canExecute"
                        @click.stop="setTarget(p)"
                    >{{ p }}°</button>
                </div>

                <!-- +/- adjustment -->
                <div class="ec-trv-adj">
                    <button
                        class="ec-adj-btn"
                        :disabled="!canExecute"
                        aria-label="Decrease"
                        @click.stop="adjustTarget(-0.5)"
                    ><i class="fas fa-minus" /></button>
                    <button
                        class="ec-adj-btn"
                        :disabled="!canExecute"
                        aria-label="Increase"
                        @click.stop="adjustTarget(0.5)"
                    ><i class="fas fa-plus" /></button>
                </div>

                <!-- Mode selector -->
                <div class="ec-trv-modes">
                    <button
                        class="ec-mode"
                        :class="{act: !isEnabled}"
                        :disabled="!canExecute"
                        @click.stop="toggleEnable"
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64A9 9 0 1 1 5.64 6.64" /><line x1="12" y1="2" x2="12" y2="12" /></svg>
                        Off
                    </button>
                    <button
                        class="ec-mode"
                        :class="{act: isEnabled}"
                        :disabled="!canExecute"
                        @click.stop="setModeHeat"
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2c0 6-6 6-6 12a6 6 0 0 0 12 0c0-6-6-6-6-12z" /></svg>
                        Heat
                    </button>
                </div>

                <!-- Boost (BluTrv only — standard thermostats don't have timed boost) -->
                <div v-if="isBluTrv" class="ec-trv-hero-boost">
                    <button class="ec-trv-boost-btn" :disabled="!canExecute" @click.stop="boost">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
                        Boost 30 min
                    </button>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :battery="isBluTrv ? batteryLevel : null" :shelly-id="entity.source" />
        </template>
        <template v-if="!isBluTrv" #toggle>
            <CardToggle :is-on="isEnabled" :disabled="!canExecute" @toggle="toggleEnable" />
        </template>
    </CardShell>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {useCardRpc} from '@/composables/useCardRpc';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
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
const rpc = useCardRpc();
const authStore = useAuthStore();

const device = computed(() => deviceStore.devices[props.entity.source]);
const isOffline = computed(() => !device.value?.online);
const isSleeping = computed(() => !!device.value?.sleeping);
const canExecute = computed(() =>
    authStore.canExecuteDevice(props.entity.source)
);

const status = computed(() => {
    if (!device.value) return null;
    const e = props.entity;
    return (
        deviceStore.statusOf(e.source, `${e.type}:${e.properties.id}`) ?? null
    );
});

const isBluTrv = computed(() => props.entity.type === 'blutrv');

const target = computed(() => status.value?.target_C ?? 20);
const current = computed(() => status.value?.current_C ?? null);
const isEnabled = computed(() =>
    isBluTrv.value ? status.value?.connected !== false : !!status.value?.enable
);
const isHeating = computed(() =>
    isBluTrv.value ? (status.value?.pos ?? 0) > 0 : !!status.value?.output
);

// Presets: 2x1 has 5° (frost protection), hero does not
const widePresets = [5, 18, 20, 22, 24];
const heroPresets = [18, 20, 22, 24];

const targetDisplay = computed(() => {
    const t = status.value?.target_C;
    return t != null ? t.toFixed(1) : '—';
});

const currentDisplay = computed(() => {
    return current.value != null ? current.value.toFixed(1) : '—';
});

const stateLabel = computed(() => {
    if (!isEnabled.value) return 'Off';
    return isHeating.value ? 'Heating' : 'Idle';
});

const valvePercent = computed(() => status.value?.pos ?? null);

const valveDisplay = computed(() => {
    const v = status.value?.pos;
    return v != null ? String(v) : '—';
});

const batteryLevel = computed(() => {
    if (isBluTrv.value) return status.value?.battery ?? null;
    const bp = device.value?.status?.['devicepower:0']?.battery;
    return bp?.percent ?? null;
});

// ── Commands ─────────────────────────────────────────────────────────────

const TARGET_MIN = 5;
const TARGET_MAX = 30;

function toggleEnable() {
    rpc.invokeAction(props.entity.id, 'setEnabled', {
        enabled: !isEnabled.value
    });
}

function setModeHeat() {
    if (!isEnabled.value) toggleEnable();
}

function setTarget(value: number) {
    const clamped = Math.max(TARGET_MIN, Math.min(TARGET_MAX, value));
    rpc.invokeAction(props.entity.id, 'setTarget', {target_C: clamped});
}

function adjustTarget(delta: number) {
    setTarget(target.value + delta);
}

// Boost = enable + max target. Two InvokeActions fire in parallel so the
// two underlying Thermostat.SetConfig calls coalesce.
function boost() {
    if (isBluTrv.value) {
        rpc.invokeAction(
            props.entity.id,
            'startBoost',
            {duration: 1800},
            'Boost'
        );
        return;
    }
    rpc.invokeAction(props.entity.id, 'setEnabled', {enabled: true});
    rpc.invokeAction(props.entity.id, 'setTarget', {target_C: TARGET_MAX});
}
</script>

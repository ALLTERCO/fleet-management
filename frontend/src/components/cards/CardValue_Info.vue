<template>
    <!-- BLU Gateway -->
    <CardShell
        v-if="entity.type === 'blugw'"
        type="input"
        :name="entity.name"
        icon="fas fa-tower-broadcast"
        :size="size"
        :is-offline="isOffline"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="info-card">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" stroke-width="2">
                    <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/>
                    <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.4"/>
                    <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.4"/>
                    <path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1"/>
                    <circle cx="12" cy="12" r="2"/>
                </svg>
                <div class="info-card-label">{{ bleDeviceCount }} {{ bleDeviceCount === 1 ? 'device' : 'devices' }}</div>
                <div class="info-card-sub">BLE Active</div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- Matter -->
    <CardShell
        v-else-if="entity.type === 'matter'"
        type="input"
        :name="entity.name"
        icon="fas fa-link"
        :size="size"
        :is-offline="isOffline"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="info-card">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10"/>
                    <path d="M12 2a15 15 0 0 0-4 10 15 15 0 0 0 4 10"/>
                    <line x1="2" y1="12" x2="22" y2="12"/>
                </svg>
                <div class="info-card-label">{{ matterEnabled ? 'Commissioned' : 'Not paired' }}</div>
                <div class="info-card-sub">Matter</div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- Schedule -->
    <CardShell
        v-else-if="entity.type === 'schedule'"
        type="input"
        :name="entity.name"
        icon="fas fa-calendar"
        :size="size"
        :is-offline="isOffline"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="info-card">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" stroke-width="2">
                    <rect x="3" y="4" width="18" height="18" rx="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                <div class="info-card-label">{{ scheduleCount }} active</div>
                <div v-if="nextScheduleTime" class="info-card-sub">Next: {{ nextScheduleTime }}</div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>
</template>

<script setup lang="ts">
import type {ScheduleListResponse} from '@api/schedule';
import {computed, onMounted, ref, watch} from 'vue';
import {useDevicesStore} from '@/stores/devices';
import {sendRPC} from '@/tools/websocket';
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

// ── Matter ───────────────────────────────────────────────────────────────

const matterEnabled = computed(() => {
    const cfg =
        device.value?.settings?.['matter:0'] ?? device.value?.settings?.matter;
    return cfg?.enable === true;
});

// ── BLU Gateway ──────────────────────────────────────────────────────────

const BLE_PREFIXES = ['bthomedevice:', 'blutrv:'];

function countBleDevices(deviceData: any): number {
    if (!deviceData) return 0;
    const allKeys = new Set([
        ...Object.keys(deviceData.settings ?? {}),
        ...Object.keys(deviceData.status ?? {})
    ]);
    return [...allKeys].filter((key) =>
        BLE_PREFIXES.some((p) => key.startsWith(p))
    ).length;
}

const bleDeviceCount = computed(() => countBleDevices(device.value));

// ── Schedule ─────────────────────────────────────────────────────────────

const scheduleJobs = ref<any[]>([]);
const scheduleCount = computed(
    () => scheduleJobs.value.filter((j: any) => j.enable).length
);

// Cron timespec format: SEC MIN HOUR MDAY MON WDAY
function parseCronTime(
    timespec: string
): {hour: number; min: number; days: number[]} | null {
    const parts = timespec?.split(' ');
    if (!parts || parts.length < 6) return null;
    const hour = Number(parts[2]);
    const min = Number(parts[1]);
    if (parts[2] === '*' || parts[1] === '*') return null;
    if (Number.isNaN(hour) || Number.isNaN(min)) return null;
    const wday = parts[5];
    const days =
        wday === '*' ? [0, 1, 2, 3, 4, 5, 6] : wday.split(',').map(Number);
    return {hour, min, days};
}

function distanceToNext(
    hour: number,
    min: number,
    allowedDays: number[]
): number {
    const now = new Date();
    const nowDay = now.getDay();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const jobMin = hour * 60 + min;
    for (let d = 0; d < 7; d++) {
        const checkDay = (nowDay + d) % 7;
        if (!allowedDays.includes(checkDay)) continue;
        if (d === 0 && jobMin <= nowMin) continue;
        return d * 1440 + (d === 0 ? jobMin - nowMin : jobMin);
    }
    return Number.MAX_SAFE_INTEGER;
}

function formatTime(hour: number, min: number): string {
    return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const nextScheduleTime = computed(() => {
    const enabled = scheduleJobs.value.filter((j: any) => j.enable);
    if (!enabled.length) return null;
    let best: {time: string; dist: number} | null = null;
    for (const job of enabled) {
        const parsed = parseCronTime(job.timespec);
        if (!parsed) continue;
        const dist = distanceToNext(parsed.hour, parsed.min, parsed.days);
        const time = formatTime(parsed.hour, parsed.min);
        if (!best || dist < best.dist) best = {time, dist};
    }
    return best?.time ?? null;
});

async function fetchSchedules() {
    if (props.entity.type !== 'schedule') return;
    const sid = device.value?.shellyID ?? props.entity.source;
    try {
        const resp = await sendRPC<ScheduleListResponse>(
            'FLEET_MANAGER',
            'Schedule.List',
            {shellyID: sid}
        );
        scheduleJobs.value = resp?.items ?? [];
    } catch {
        /* device offline or unreachable */
    }
}

// Fetch on mount if online
onMounted(() => {
    if (!isOffline.value) fetchSchedules();
});

// Retry when device comes online (handles sleeping/offline devices)
watch(isOffline, (offline) => {
    if (
        !offline &&
        props.entity.type === 'schedule' &&
        !scheduleJobs.value.length
    ) {
        fetchSchedules();
    }
});
</script>

<style scoped>
.info-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1-5);
    height: 100%;
}
.info-card-label {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-secondary);
}
.info-card-sub {
    font-size: var(--type-body);
    color: var(--color-text-quaternary);
}
</style>

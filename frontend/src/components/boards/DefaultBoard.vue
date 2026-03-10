<template>
    <div class="space-y-3 h-full p-3">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-disabled)]">Overview</h2>
        <div class="grid grid-cols-2 gap-4">
            <button class="stat-card stat-card--default" @click="navigate('/devices?online=all')">
                <span class="stat-card__value">{{ Object.keys(deviceStore.devices).length }}</span>
                <span class="stat-card__label">All Devices</span>
            </button>
            <button class="stat-card stat-card--danger" @click="navigate('/devices?online=0')">
                <span class="stat-card__value">{{ offlineDevices }}</span>
                <span class="stat-card__label">Offline</span>
            </button>
            <button class="stat-card stat-card--default" @click="navigate('/devices/entities')">
                <span class="stat-card__value">{{ Object.keys(entitiesStore.entities).length }}</span>
                <span class="stat-card__label">Entities</span>
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {useRouter} from 'vue-router';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useRightSideMenuStore} from '@/stores/right-side';

const router = useRouter();
const deviceStore = useDevicesStore();
const entitiesStore = useEntityStore();
const rightSideStore = useRightSideMenuStore();

const offlineDevices = computed(() => {
    return Object.keys(deviceStore.devices).length - deviceStore.onlineCount;
});

function navigate(path: string) {
    rightSideStore.clearActiveComponent();
    router.push(path);
}
</script>

<style scoped>
.stat-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-4) var(--space-3);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    transition: background-color var(--duration-fast) var(--ease-default),
                border-color var(--duration-fast) var(--ease-default),
                transform var(--duration-fast) var(--ease-out);
    cursor: pointer;
    text-decoration: none;
}
.stat-card:hover {
    background-color: var(--color-surface-3);
    border-color: var(--color-border-strong);
    transform: translateY(-1px);
}
.stat-card__value {
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    line-height: var(--leading-tight);
}
.stat-card__label {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    margin-top: var(--space-1);
}
.stat-card--danger .stat-card__value {
    color: var(--color-danger-text);
}
.stat-card--danger .stat-card__label {
    color: var(--color-danger-text);
}
.stat-card--danger:hover {
    border-color: var(--color-danger);
}
</style>

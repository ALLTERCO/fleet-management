<template>
    <div>
        <h1 class="text-lg font-semibold mb-1">Monitoring</h1>
        <TabPageSelector :tabs="displayedTabs" />
    </div>
</template>

<script setup lang="ts">
import {storeToRefs} from 'pinia';
import {computed, onMounted, onUnmounted} from 'vue';
import TabPageSelector from '@/components/core/TabPageSelector.vue';
import {useMonitoringStore} from '@/stores/monitoring';
import {useSystemStore} from '@/stores/system';

const monitoringStore = useMonitoringStore();
const systemStore = useSystemStore();
const {devMode} = storeToRefs(systemStore);

const allTabs: [string, string, string][] = [
    ['Overview', '/monitoring/overview', 'fas fa-heart-pulse'],
    ['Device Ingest', '/monitoring/device-ingest', 'fas fa-arrow-right-to-bracket'],
    ['Commands', '/monitoring/commands', 'fas fa-terminal'],
    ['Database', '/monitoring/database', 'fas fa-database'],
    ['Events', '/monitoring/events', 'fas fa-bolt'],
    ['Services', '/monitoring/services', 'fas fa-server'],
    ['Logs', '/monitoring/logs', 'fas fa-file-lines']
];

const displayedTabs = computed<[string, string, string][]>(() => {
    if (monitoringStore.obsLevel === 0) {
        return [
            ['Overview', '/monitoring/overview', 'fas fa-heart-pulse'],
            ['Logs', '/monitoring/logs', 'fas fa-file-lines'],
            ['Audit Log', '/monitoring/audit-log', 'fas fa-clipboard-list'],
            ['Control Panel', '/monitoring/control-panel', 'fas fa-sliders']
        ];
    }
    const tabs: [string, string, string][] = [...allTabs];
    tabs.push(['Audit Log', '/monitoring/audit-log', 'fas fa-clipboard-list']);
    tabs.push(['Control Panel', '/monitoring/control-panel', 'fas fa-sliders']);
    return tabs;
});

onMounted(() => monitoringStore.startPolling());
onUnmounted(() => monitoringStore.stopPolling());
</script>

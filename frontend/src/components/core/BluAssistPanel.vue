<template>
    <div class="bap-panel">
        <nav class="bap-tabs" role="tablist">
            <button
                v-for="tab in tabs"
                :key="tab.id"
                type="button"
                role="tab"
                class="bap-tab"
                :class="{'bap-tab--active': active === tab.id}"
                :aria-selected="active === tab.id"
                @click="active = tab.id"
            >
                <i :class="tab.icon" />
                {{ tab.label }}
            </button>
        </nav>
        <section v-if="active === 'scan'" class="bap-section">
            <BluAssistScanPanel :shelly-i-d="shellyID" />
        </section>
        <section v-else class="bap-section">
            <BluAssistConnectionsPanel :shelly-i-d="shellyID" />
        </section>
    </div>
</template>

<script setup lang="ts">
import {ref} from 'vue';
import BluAssistConnectionsPanel from './BluAssistConnectionsPanel.vue';
import BluAssistScanPanel from './BluAssistScanPanel.vue';

defineProps<{shellyID: string}>();

type TabId = 'scan' | 'connections';
const active = ref<TabId>('scan');
const tabs: ReadonlyArray<{id: TabId; label: string; icon: string}> = [
    {id: 'scan', label: 'Scan', icon: 'fas fa-radar'},
    {id: 'connections', label: 'Connections', icon: 'fas fa-plug'}
];
</script>

<style scoped>
.bap-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.bap-tabs {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    width: fit-content;
}
.bap-tab {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1-5) var(--space-3);
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    border-radius: var(--radius-sm);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
}
.bap-tab--active {
    background: var(--color-primary);
    color: white;
}
.bap-section {
    width: 100%;
}
</style>

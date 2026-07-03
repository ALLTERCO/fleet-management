<template>
    <PageTemplate title="Automations" :tabs="automationsTabs" bare>
        <Notification v-if="isDevMode" type="warning">
            Grafana is <b>not</b> available in <b>development</b> mode
        </Notification>
        <div v-else-if="!grafanaEnabled" class="gf-disabled">
            <i class="fas fa-chart-mixed gf-disabled__icon" />
            <h3>Grafana is not enabled</h3>
            <p>
                This deployment was started without the Grafana add-on.
                Add the add-on or set
                <code>FM_GRAFANA_ADDON_ENABLED=true</code> to enable the
                dashboards UI.
            </p>
        </div>
        <iframe
            v-else
            class="gf-frame"
            src="/grafana/"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            referrerpolicy="no-referrer"
        />
    </PageTemplate>
</template>

<script setup lang="ts">
import {type ComputedRef, computed, inject} from 'vue';
import Notification from '@/components/core/Notification.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import {useSystemStore} from '@/stores/system';
import type {RouteTab} from '@/types/page-template';

const automationsTabs = inject<RouteTab[] | ComputedRef<RouteTab[]>>(
    'automationsTabs',
    [] as RouteTab[]
);
const isDevMode = import.meta.env.MODE === 'development';
const systemStore = useSystemStore();
const grafanaEnabled = computed(() => {
    const cfg = systemStore.config.grafana;
    return Boolean(cfg && Object.keys(cfg).length > 0);
});
</script>

<style scoped>
.gf-frame {
    flex: 1;
    width: 100%;
    border: 0;
    display: block;
    min-height: 0;
}
.gf-disabled {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: var(--space-12) var(--space-6);
    color: var(--color-text-primary);
    gap: var(--space-3);
}
.gf-disabled__icon {
    font-size: var(--type-heading);
    color: var(--color-text-tertiary);
}
.gf-disabled code {
    background: var(--color-surface-2);
    padding: var(--space-px) var(--space-1-5);
    border-radius: var(--radius-sm);
    font-family: monospace;
    font-size: 0.9em;
}
</style>

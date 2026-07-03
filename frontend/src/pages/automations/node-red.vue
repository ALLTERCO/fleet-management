<template>
    <PageTemplate title="Automations" :tabs="automationsTabs" bare>
        <div v-if="!NODE_RED_ENABLED" class="nr-disabled">
            <i class="fas fa-plug-circle-xmark nr-disabled__icon" />
            <h3>Node-RED is not enabled</h3>
            <p>
                This deployment was started without the Node-RED add-on.
                Re-deploy with <code>--with nodered</code> or set
                <code>FM_NODE_RED_ENABLED=true</code> to enable the
                visual flow editor.
            </p>
        </div>
        <iframe
            v-else-if="sessionReady"
            class="nr-frame"
            :src="NODE_RED_URL"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            referrerpolicy="no-referrer"
        />
    </PageTemplate>
</template>

<script setup lang="ts">
import {type ComputedRef, inject, onMounted, ref} from 'vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import {NODE_RED_ENABLED, NODE_RED_SESSION_URL, NODE_RED_URL} from '@/constants';
import {getZitadelAuth} from '@/helpers/zitadelAuth';
import type {RouteTab} from '@/types/page-template';

const automationsTabs = inject<RouteTab[] | ComputedRef<RouteTab[]>>(
    'automationsTabs',
    [] as RouteTab[]
);
const sessionReady = ref(false);

onMounted(async () => {
    if (!NODE_RED_ENABLED) return;
    const zitadelAuth = getZitadelAuth();
    if (!zitadelAuth) return;
    const user = await zitadelAuth.oidcAuth.mgr.getUser();
    const token = user?.access_token;
    if (!token) return;
    const response = await fetch(NODE_RED_SESSION_URL, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${token}`
        },
        credentials: 'include'
    });
    sessionReady.value = response.ok;
});
</script>

<style scoped>
.nr-frame {
    flex: 1;
    width: 100%;
    border: 0;
    display: block;
    min-height: 0;
}
.nr-disabled {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: var(--space-12) var(--space-6);
    color: var(--color-text-primary);
    gap: var(--space-3);
}
.nr-disabled__icon {
    font-size: var(--type-heading);
    color: var(--color-text-tertiary);
}
.nr-disabled code {
    background: var(--color-surface-2);
    padding: var(--space-px) var(--space-1-5);
    border-radius: var(--radius-sm);
    font-family: monospace;
    font-size: 0.9em;
}
</style>

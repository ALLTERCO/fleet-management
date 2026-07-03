<template>
    <PageTemplate title="General" :tabs="tabs">
        <div class="general-settings">
            <h2 class="sr-only">General Settings</h2>

            <RouterLink
                v-if="canManageBranding"
                to="/settings/branding"
                class="gs-branding-card"
            >
                <div class="gs-branding-card__icon">
                    <i class="fas fa-palette" />
                </div>
                <div class="gs-branding-card__body">
                    <span class="gs-branding-card__title">Branding &amp; policies</span>
                    <span class="gs-branding-card__sub">
                        Login logo, primary colors, privacy &amp; domain
                        policies for your workspace.
                    </span>
                </div>
                <i class="fas fa-chevron-right gs-branding-card__chev" />
            </RouterLink>

            <AppSettings :version="version" />
            <OrganizationSettings />
            <Developer v-if="authStore.devMode" />
        </div>
    </PageTemplate>
</template>

<script setup lang="ts">
import {type ComputedRef, computed, inject} from 'vue';
import {RouterLink} from 'vue-router';
import PageTemplate from '@/components/core/PageTemplate.vue';
import AppSettings from '@/components/pages/settings/AppSettings.vue';
import Developer from '@/components/pages/settings/Developer.vue';
import OrganizationSettings from '@/components/pages/settings/OrganizationSettings.vue';
import {useRpcPermissions} from '@/helpers/rpcPermissions';
import {useAuthStore} from '@/stores/auth';
import type {RouteTab} from '@/types/page-template';

// Displayed app version. Decoupled from package.json so a frontend cut
// can carry a different marketed version than the npm metadata.
const version = '1.9.0';
const authStore = useAuthStore();
const rpc = useRpcPermissions();

const tabs = inject<ComputedRef<RouteTab[]>>(
    'settingsTabs',
    computed(() => [])
);

const canManageBranding = computed(() => rpc.canCall('Branding.SetPolicy'));
</script>

<style scoped>
.general-settings {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    padding-top: var(--gap-sm);
}

.gs-branding-card {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-sm);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface-1);
    color: var(--color-text-primary);
    text-decoration: none;
    transition:
        background-color var(--duration-fast) var(--ease-default),
        border-color var(--duration-fast) var(--ease-default);
}
.gs-branding-card:hover {
    background-color: var(--color-surface-2);
    border-color: var(--color-border-strong);
}
.gs-branding-card__icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: var(--radius-md);
    background-color: color-mix(in srgb, var(--color-primary) 14%, transparent);
    color: var(--color-primary);
    font-size: var(--type-subheading);
}
.gs-branding-card__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    flex: 1;
    min-width: 0;
}
.gs-branding-card__title {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.gs-branding-card__sub {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.gs-branding-card__chev {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
</style>

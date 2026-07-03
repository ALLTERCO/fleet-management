<template>
    <div class="dev-template">
        <header class="dev-template__header">
            <div>
                <p class="dev-template__eyebrow">{{ customization.clientName }}</p>
                <h1>{{ customization.title }}</h1>
                <p>{{ customization.subtitle }}</p>
            </div>
            <div class="dev-template__user">
                {{ user.name || user.username || 'Not signed in' }}
            </div>
        </header>

        <main class="dev-template__grid">
            <section class="dev-template__panel">
                <span class="dev-template__metric">{{ devices.data.value.length }}</span>
                <span>Devices</span>
            </section>
            <section class="dev-template__panel">
                <span class="dev-template__metric">{{ onlineCount }}</span>
                <span>Online</span>
            </section>
            <section class="dev-template__panel">
                <span class="dev-template__metric">{{ groups.data.value.length }}</span>
                <span>Groups</span>
            </section>
        </main>
    </div>
</template>

<script setup lang="ts">
import {
    useCurrentUser,
    useCustomization,
    useDevices,
    useGroups
} from '@host/index';
import {computed, onMounted} from 'vue';

const customization = useCustomization();
const user = useCurrentUser();
const devices = useDevices();
const groups = useGroups();
const onlineCount = computed(
    () => devices.data.value.filter((device) => device.online).length
);

onMounted(() => {
    void devices.refresh();
    void groups.refresh();
});
</script>

<style scoped>
.dev-template {
    min-height: 100vh;
    padding: var(--space-8);
    color: var(--fm-template-text);
    background: var(--fm-template-background);
}

.dev-template__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-6);
    max-width: 1120px;
    margin: 0 auto 28px;
}

.dev-template__eyebrow,
.dev-template__user {
    color: var(--fm-template-accent);
    font-weight: 700;
}

.dev-template h1 {
    margin: 0;
    font-size: var(--type-subheading);
}

.dev-template__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--space-4);
    max-width: 1120px;
    margin: 0 auto;
}

.dev-template__panel {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-5);
    border: 1px solid color-mix(in srgb, var(--fm-template-text) 14%, transparent);
    border-radius: var(--radius-md);
    background: var(--fm-template-card);
}

.dev-template__metric {
    font-size: var(--type-subheading);
    font-weight: 800;
}
</style>

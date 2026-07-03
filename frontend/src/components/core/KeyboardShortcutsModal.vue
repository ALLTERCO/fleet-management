<template>
    <Modal :visible="visible" @close="$emit('close')">
        <template #title>Keyboard Shortcuts</template>
        <div v-if="sections.length === 0" class="ks-empty">
            No shortcuts active on this screen.
        </div>
        <div v-else class="ks-grid">
            <div v-for="section in sections" :key="section.name" class="ks-section">
                <div class="ks-section-title">{{ section.name }}</div>
                <div v-for="s in section.items" :key="s.id" class="ks-row">
                    <span>{{ s.description }}</span>
                    <kbd class="ks-key">{{ s.display }}</kbd>
                </div>
            </div>
        </div>
    </Modal>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import Modal from '@/components/modals/Modal.vue';
import {useShortcuts} from '@/config/shortcuts';

defineProps<{visible: boolean}>();
defineEmits<{close: []}>();

const shortcuts = useShortcuts();

const sections = computed(() => {
    const bySection = new Map<string, typeof shortcuts.value>();
    for (const s of shortcuts.value) {
        const list = bySection.get(s.section) ?? [];
        list.push(s);
        bySection.set(s.section, list);
    }
    return [...bySection.entries()].map(([name, items]) => ({name, items}));
});
</script>

<style scoped>
.ks-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
}
.ks-empty {
    padding: var(--space-4);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    text-align: center;
}
.ks-section-title {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: var(--space-2);
}
.ks-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-1) 0;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}
.ks-key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-3);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-family: var(--font-mono);
    font-weight: 500;
    flex-shrink: 0;
}
@media (max-width: 600px) {
    .ks-grid { grid-template-columns: 1fr; }
}
</style>

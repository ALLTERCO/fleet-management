<template>
    <Modal :visible="visible" compact @close="emit('close')">
        <template #title>{{ name }}</template>
        <template #default>
            <div class="vd">
                <!-- Reference syntax -->
                <div class="vd-ref">
                    <code class="vd-ref__code">{{ '$' + '{' + name + '}' }}</code>
                    <Button type="blue-hollow" size="xs" @click="copyRef">
                        Copy
                    </Button>
                </div>

                <!-- Category -->
                <div v-if="category" class="vd-section">
                    <div class="vd-label">Category</div>
                    <div class="vd-category-tag">{{ category }}</div>
                </div>

                <!-- Description -->
                <div v-if="description" class="vd-section">
                    <div class="vd-label">Description</div>
                    <div class="vd-desc">{{ description }}</div>
                </div>

                <!-- Value -->
                <div class="vd-section">
                    <div class="vd-label">Value</div>
                    <div class="vd-value">{{ value || '—' }}</div>
                </div>

                <!-- Usage -->
                <div class="vd-section">
                    <div class="vd-label">Used in {{ usageActions.length }} action{{ usageActions.length === 1 ? '' : 's' }}</div>
                    <div v-if="usageActions.length" class="vd-usage-list">
                        <div v-for="action in usageActions" :key="action.id" class="vd-usage-item">
                            <i class="fas fa-play" />
                            <span class="vd-usage-name">{{ action.name }}</span>
                        </div>
                    </div>
                    <div v-else class="vd-usage-empty">Not referenced in any action</div>
                </div>
            </div>
        </template>
        <template #footer>
            <div class="vd-footer">
                <Button type="red" size="sm" @click="emit('delete')">
                    Delete
                </Button>
                <div class="vd-spacer" />
                <Button type="blue-hollow" size="sm" @click="emit('edit')">
                    Edit
                </Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import Button from '@/components/core/Button.vue';
import {useToastStore} from '@/stores/toast';
import Modal from './Modal.vue';

const props = defineProps<{
    visible: boolean;
    name: string;
    value: string;
    description?: string;
    category?: string;
    usageActions: Array<{id: string; name: string}>;
}>();

const emit = defineEmits<{
    close: [];
    edit: [];
    delete: [];
}>();

const toast = useToastStore();

function copyRef() {
    navigator.clipboard
        .writeText(`\${${props.name}}`)
        .then(() => toast.success(`Copied \${${props.name}}`))
        .catch(() => toast.error('Copy failed'));
}
</script>

<style scoped>
.vd { display: flex; flex-direction: column; gap: var(--gap-sm); }

.vd-ref {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-sm);
    border-radius: var(--radius-md);
    background: var(--color-surface-0);
    border: 1px solid var(--color-border-medium);
}
.vd-ref__code {
    flex: 1;
    font-family: var(--font-mono);
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--a-action);
}

.vd-section { display: flex; flex-direction: column; gap: var(--gap-xs); }
.vd-label { font-size: var(--type-body); font-weight: 700; color: var(--color-text-secondary); }
.vd-value {
    font-family: var(--font-mono);
    font-size: var(--type-body);
    color: var(--color-text-primary);
    word-break: break-all;
    padding: var(--gap-xs);
    border-radius: var(--radius-sm);
    background: var(--color-surface-0);
    border: 1px solid var(--color-border-medium);
}

.vd-category-tag {
    display: inline-flex;
    padding: var(--gap-xs) var(--gap-sm);
    border-radius: var(--radius-md);
    background: rgba(var(--ar-action), 0.08);
    border: 1px solid rgba(var(--ar-action), 0.2);
    color: var(--a-action);
    font-size: var(--type-body); font-weight: 700;
}
.vd-desc {
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}
.vd-usage-list { display: flex; flex-direction: column; gap: var(--gap-xs); }
.vd-usage-item {
    display: flex; align-items: center; gap: var(--gap-xs);
    padding: var(--gap-xs) var(--gap-sm);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    font-size: var(--type-body);
}
.vd-usage-item i { color: var(--color-text-disabled); }
.vd-usage-name { font-weight: 600; color: var(--color-text-primary); }
.vd-usage-empty { font-size: var(--type-body); color: var(--color-text-disabled); }

.vd-footer { display: flex; align-items: center; gap: var(--gap-sm); }
.vd-spacer { flex: 1; }
</style>

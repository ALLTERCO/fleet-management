<template>
    <Modal :visible="visible" wide @close="emit('close')">
        <template #title>{{ template?.name ?? 'Template' }}</template>

        <div v-if="template" class="tpv">
            <p v-if="template.description" class="tpv__desc">
                {{ template.description }}
            </p>

            <div v-if="template.subjectTemplate" class="tpv__field">
                <span class="tpv__label">Subject</span>
                <div class="tpv__subject">{{ template.subjectTemplate }}</div>
            </div>

            <div v-if="template.htmlTemplate" class="tpv__field">
                <span class="tpv__label">HTML preview</span>
                <!-- Sandboxed, no scripts: renders the markup, runs nothing. -->
                <iframe
                    class="tpv__frame"
                    sandbox=""
                    :srcdoc="template.htmlTemplate"
                    title="HTML template preview"
                />
            </div>

            <div v-if="template.textTemplate" class="tpv__field">
                <span class="tpv__label">Text</span>
                <pre class="tpv__text">{{ template.textTemplate }}</pre>
            </div>

            <p
                v-if="!template.htmlTemplate && !template.textTemplate"
                class="tpv__empty"
            >
                This template has no HTML or text body yet.
            </p>
        </div>

        <template #footer>
            <div class="tpv__foot">
                <Button type="blue-hollow" @click="emit('close')">Close</Button>
                <span class="tpv__spacer" />
                <Button v-if="canWrite" type="blue" @click="emit('edit')">
                    Edit
                </Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import Button from '@/components/core/Button.vue';
import Modal from '@/components/modals/Modal.vue';
import {usePermissions} from '@/composables/usePermissions';
import type {EmailTemplate} from '@/stores/notifications';

defineProps<{
    visible: boolean;
    template: EmailTemplate | null;
}>();
const emit = defineEmits<{close: []; edit: []}>();

const {canWrite} = usePermissions();
</script>

<style scoped>
.tpv {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}
.tpv__desc {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
}
.tpv__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.tpv__label {
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.tpv__subject {
    font-weight: var(--font-weight-medium);
}
.tpv__frame {
    width: 100%;
    min-height: 360px;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    background: #fff;
}
.tpv__text {
    margin: 0;
    padding: var(--space-3);
    background: var(--glass-input);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    white-space: pre-wrap;
}
.tpv__empty {
    margin: 0;
    color: var(--color-text-secondary);
}
.tpv__foot {
    display: flex;
    align-items: center;
    width: 100%;
}
.tpv__spacer {
    flex: 1;
}
</style>

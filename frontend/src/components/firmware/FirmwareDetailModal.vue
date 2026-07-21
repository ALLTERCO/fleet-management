<template>
    <Modal :visible="visible" @close="emit('close')">
        <template #title>{{ item?.name || item?.originalFileName }}</template>

        <div v-if="item" class="fwd">
            <div class="fwd__grid">
                <div v-if="item.model" class="fwd__field">
                    <span class="fwd__label">Model</span>
                    <span class="fwd__value">{{ item.model }}</span>
                </div>
                <div v-if="item.app" class="fwd__field">
                    <span class="fwd__label">App</span>
                    <span class="fwd__value">{{ item.app }}</span>
                </div>
                <div v-if="item.ver" class="fwd__field">
                    <span class="fwd__label">Version</span>
                    <span class="fwd__value">{{ item.ver }}</span>
                </div>
                <div v-if="item.channel" class="fwd__field">
                    <span class="fwd__label">Channel</span>
                    <span class="fwd__value fwd__value--cap">{{ item.channel }}</span>
                </div>
                <div v-if="item.fwId" class="fwd__field">
                    <span class="fwd__label">Build ID</span>
                    <span class="fwd__value fwd__value--mono">{{ item.fwId }}</span>
                </div>
                <div class="fwd__field">
                    <span class="fwd__label">Size</span>
                    <span class="fwd__value">{{ formatBytes(item.fileSize) }}</span>
                </div>
                <div class="fwd__field">
                    <span class="fwd__label">Uploaded</span>
                    <span class="fwd__value">{{ formatDate(item.uploadedAt) }}</span>
                    <span class="fwd__sub">by {{ item.uploadedBy }}</span>
                </div>
                <div class="fwd__field fwd__field--wide">
                    <span class="fwd__label">File</span>
                    <span class="fwd__value">{{ item.originalFileName }}</span>
                </div>
                <div class="fwd__field fwd__field--wide">
                    <span class="fwd__label">Checksum (SHA-256)</span>
                    <span class="fwd__value fwd__value--mono">{{ item.checksum }}</span>
                </div>
            </div>

            <div v-if="item.tags.length > 0" class="fwd__section">
                <span class="fwd__label">Tags</span>
                <div class="fwd__chips">
                    <span v-for="tag in item.tags" :key="tag" class="fwd__chip">{{ tag }}</span>
                </div>
            </div>

            <p class="fwd__compat" :class="{'fwd__compat--ok': canFlash}">
                {{ canFlash
                    ? 'Compatible with your selected devices'
                    : 'No compatible device in the current selection' }}
            </p>
        </div>

        <template #footer>
            <div class="fwd__footer">
                <Button type="red" size="sm" @click="emit('delete')">Delete</Button>
                <div class="fwd__footer-right">
                    <Button type="blue-hollow" size="sm" @click="emit('download')">Download</Button>
                    <Button type="blue-hollow" size="sm" @click="emit('edit')">Edit</Button>
                    <Button type="blue" size="sm" :disabled="!canFlash" @click="emit('flash')">
                        Flash
                    </Button>
                </div>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import type {FirmwareLibraryItem} from '@api/firmware';
import Button from '@/components/core/Button.vue';
import Modal from '@/components/modals/Modal.vue';
import {formatBytes, formatDate} from '@/helpers/format';

defineProps<{
    visible: boolean;
    item: FirmwareLibraryItem | null;
    canFlash: boolean;
}>();

const emit = defineEmits<{
    close: [];
    flash: [];
    edit: [];
    delete: [];
    download: [];
}>();
</script>

<style scoped>
.fwd {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
}
.fwd__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3) var(--space-5);
}
.fwd__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}
.fwd__field--wide {
    grid-column: 1 / -1;
}
.fwd__label {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
}
.fwd__value {
    /* Medium weight, proportional: readable but quieter than the title. */
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
}
.fwd__value--cap {
    text-transform: capitalize;
}
.fwd__value--mono {
    /* Technical ids (build id, checksum) read better in monospace. */
    font-family: var(--font-mono);
    color: var(--color-text-secondary);
    font-weight: var(--font-normal);
}
.fwd__sub {
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
}
.fwd__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.fwd__chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}
.fwd__chip {
    padding: var(--space-1) var(--space-3);
    background: var(--color-surface-3);
    border-radius: var(--radius-full);
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
}
.fwd__compat {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
}
.fwd__compat--ok {
    color: var(--color-success-text);
}
.fwd__footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
}
.fwd__footer-right {
    display: flex;
    gap: var(--space-2);
}
</style>

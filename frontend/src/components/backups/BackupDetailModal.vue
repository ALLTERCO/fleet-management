<template>
    <Modal :visible="visible" @close="emit('close')">
        <template #title>{{ backup?.name }}</template>

        <div v-if="backup" class="bkd">
            <div class="bkd__grid">
                <div class="bkd__field">
                    <span class="bkd__label">Device</span>
                    <span class="bkd__value">{{ backup.deviceName || backup.shellyID }}</span>
                    <span class="bkd__sub">{{ backup.shellyID }}</span>
                </div>
                <div class="bkd__field">
                    <span class="bkd__label">Model</span>
                    <span class="bkd__value">{{ backup.model }}</span>
                </div>
                <div class="bkd__field">
                    <span class="bkd__label">App</span>
                    <span class="bkd__value">{{ backup.app }}</span>
                </div>
                <div class="bkd__field">
                    <span class="bkd__label">Firmware</span>
                    <span class="bkd__value">{{ backup.fwVersion }}</span>
                </div>
                <div class="bkd__field">
                    <span class="bkd__label">Created (UTC)</span>
                    <span class="bkd__value">{{ formatCreatedAtUtc(backup.createdAt) }}</span>
                </div>
                <div class="bkd__field">
                    <span class="bkd__label">Size</span>
                    <span class="bkd__value">{{ formatBytes(backup.fileSize) }}</span>
                </div>
            </div>

            <div v-if="backupContents.length > 0" class="bkd__section">
                <span class="bkd__label">Contents</span>
                <div class="bkd__chips">
                    <span v-for="item in backupContents" :key="item" class="bkd__chip">{{ item }}</span>
                </div>
            </div>

            <div v-if="(backup.groupNames || []).length > 0" class="bkd__section">
                <span class="bkd__label">Groups</span>
                <div class="bkd__chips">
                    <span v-for="group in backup.groupNames" :key="group" class="bkd__chip">{{ group }}</span>
                </div>
            </div>
        </div>

        <template #footer>
            <div class="bkd__footer">
                <Button type="red" size="sm" @click="emit('action', 'delete')">
                    Delete
                </Button>
                <div class="bkd__footer-right">
                    <Button type="blue-hollow" size="sm" @click="emit('action', 'rename')">Rename</Button>
                    <Button type="blue-hollow" size="sm" @click="emit('action', 'download')">
                        Download
                    </Button>
                    <Button type="blue" size="sm" @click="emit('action', 'restore')">
                        Restore
                    </Button>
                </div>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import Button from '@/components/core/Button.vue';
import Modal from '@/components/modals/Modal.vue';
import {getEnabledBackupContentLabels} from '@/helpers/backupContents';
import {formatBytes} from '@/helpers/format';
import type {BackupMetadata} from '@/stores/backups';

const props = defineProps<{
    visible: boolean;
    backup: BackupMetadata | null;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'action', action: 'restore' | 'rename' | 'download' | 'delete'): void;
}>();

const backupContents = computed(() => {
    if (!props.backup?.contents) return [];
    return getEnabledBackupContentLabels(props.backup.contents);
});


function formatCreatedAtUtc(timestamp: number): string {
    return new Date(timestamp)
        .toISOString()
        .replace('T', ' ')
        .slice(0, 16)
        .concat(' UTC');
}
</script>

<style scoped>
.bkd {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
}

.bkd__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3) var(--space-5);
}

.bkd__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2); /* golden base */
}

.bkd__label {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
}

.bkd__value {
    /* Medium weight: readable but quieter than the modal title. */
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    color: var(--color-text-primary);
}

.bkd__sub {
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
    font-family: var(--font-mono);
}

.bkd__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.bkd__chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}

.bkd__chip {
    padding: var(--space-1) var(--space-3);
    background: var(--color-surface-3);
    border-radius: var(--radius-full);
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
}

.bkd__footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
}

.bkd__footer-right {
    display: flex;
    gap: var(--space-2);
}
</style>

<template>
    <Modal :visible="visible" @close="emit('close')">
        <template #title>
            <div class="flex items-center gap-2">
                <i class="fas fa-database"></i>
                <span>{{ backup?.name }}</span>
            </div>
        </template>

        <div v-if="backup" class="flex flex-col gap-4">
            <div class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                    <span class="text-[var(--color-text-tertiary)]">Device</span>
                    <div class="font-medium">{{ backup.shellyID }}</div>
                </div>
                <div>
                    <span class="text-[var(--color-text-tertiary)]">Model</span>
                    <div class="font-medium">{{ backup.model }}</div>
                </div>
                <div>
                    <span class="text-[var(--color-text-tertiary)]">App</span>
                    <div class="font-medium">{{ backup.app }}</div>
                </div>
                <div>
                    <span class="text-[var(--color-text-tertiary)]">Firmware</span>
                    <div class="font-medium">{{ backup.fwVersion }}</div>
                </div>
                <div>
                    <span class="text-[var(--color-text-tertiary)]">Created</span>
                    <div class="font-medium">
                        {{ new Date(backup.createdAt).toLocaleString() }}
                    </div>
                </div>
                <div>
                    <span class="text-[var(--color-text-tertiary)]">Size</span>
                    <div class="font-medium">
                        {{ formatSize(backup.fileSize) }}
                    </div>
                </div>
            </div>

            <!-- Contents -->
            <div v-if="backupContents.length > 0">
                <span class="text-[var(--color-text-tertiary)] text-sm">Contents</span>
                <div class="flex flex-wrap gap-1 mt-1">
                    <span
                        v-for="item in backupContents"
                        :key="item"
                        class="px-2 py-0.5 rounded bg-[var(--color-surface-3)] text-xs"
                        >{{ item }}</span
                    >
                </div>
            </div>

            <!-- Metadata -->
            <div v-if="backupMeta.length > 0">
                <span class="text-[var(--color-text-tertiary)] text-sm">Metadata</span>
                <div
                    class="grid grid-cols-2 gap-x-6 gap-y-1 text-sm mt-1"
                >
                    <div v-for="[k, v] in backupMeta" :key="k">
                        <span class="text-[var(--color-text-tertiary)]">{{ k }}:</span>
                        {{ v }}
                    </div>
                </div>
            </div>
        </div>

        <template #footer>
            <div class="flex justify-between">
                <Button
                    type="red"
                    size="sm"
                    @click="emit('action', 'delete')"
                >
                    <i class="fas fa-trash mr-1"></i> Delete
                </Button>
                <div class="flex gap-2">
                    <Button
                        size="sm"
                        @click="emit('action', 'rename')"
                    >
                        <i class="fas fa-pen mr-1"></i> Rename
                    </Button>
                    <Button
                        type="green"
                        size="sm"
                        @click="emit('action', 'download')"
                    >
                        <i class="fas fa-download mr-1"></i> Download
                    </Button>
                    <Button
                        type="blue"
                        size="sm"
                        @click="emit('action', 'restore')"
                    >
                        <i class="fas fa-upload mr-1"></i> Restore
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
    return Object.entries(props.backup.contents)
        .filter(([, v]) => v)
        .map(([k]) => k);
});

const backupMeta = computed(() => {
    if (!props.backup?.metadata) return [];
    return Object.entries(props.backup.metadata)
        .filter(([k]) => String(k).trim().length > 0)
        .map(
            ([k, v]) =>
                [String(k), v == null ? '' : String(v)] as [string, string]
        );
});

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

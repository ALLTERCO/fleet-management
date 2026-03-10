<template>
    <Modal :visible="visible" @close="emit('close')">
        <template #title>Rename Backup</template>

        <div class="flex flex-col gap-4">
            <input
                v-model="nameInput"
                type="text"
                class="w-full bg-[var(--color-surface-3)] border border-[var(--color-border-strong)] rounded px-3 py-2 text-sm text-white focus:border-[var(--color-primary)] focus:outline-none"
                placeholder="Enter backup name"
                aria-label="Backup name"
                @keyup.enter="doRename"
            />
            <span class="text-xs text-[var(--color-text-disabled)]">
                If a backup with the same name already exists, it
                will be overwritten.
            </span>
        </div>

        <template #footer>
            <div class="flex justify-end gap-2">
                <Button @click="emit('close')">Cancel</Button>
                <Button
                    type="blue"
                    :disabled="!nameInput.trim()"
                    @click="doRename"
                >
                    Save
                </Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Modal from '@/components/modals/Modal.vue';
import {useBackupsStore} from '@/stores/backups';
import {useToastStore} from '@/stores/toast';

const props = defineProps<{
    visible: boolean;
    backupId: string;
    backupName: string;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'renamed'): void;
}>();

const backupsStore = useBackupsStore();
const toastStore = useToastStore();

const nameInput = ref('');

// Sync input when modal opens
watch(
    () => props.visible,
    (isVisible) => {
        if (isVisible) {
            nameInput.value = props.backupName;
        }
    }
);

async function doRename() {
    if (!props.backupId || !nameInput.value.trim()) return;

    try {
        await backupsStore.renameBackup(props.backupId, nameInput.value.trim());
        toastStore.success('Backup renamed');
        emit('renamed');
        emit('close');
    } catch (error: any) {
        toastStore.error(error?.message || 'Failed to rename backup');
    }
}
</script>

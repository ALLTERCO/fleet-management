<template>
    <Modal :visible="visible" @close="emit('close')">
        <template #title>Rename Backup</template>

        <div class="brm__body">
            <FormField label="Backup name">
                <Input v-model="nameInput" :placeholder="backupName" @keyup.enter="doRename" aria-label="Backup name" />
            </FormField>
            <span class="text-base text-[var(--color-text-disabled)]">
                If a backup with the same name already exists, it
                will be overwritten.
            </span>
        </div>

        <template #footer>
            <div class="flex justify-end gap-2">
                <Button type="blue-hollow" @click="emit('close')">Cancel</Button>
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
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
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

    const newName = nameInput.value.trim();
    const oldName = props.backupName;
    const backupId = props.backupId;

    try {
        await backupsStore.renameBackup(backupId, newName);
        toastStore.undoable(
            `Backup renamed to "${newName}"`,
            () => {},
            () => revertRename(backupId, oldName)
        );
        emit('renamed');
        emit('close');
    } catch (error: any) {
        toastStore.error(error?.message || 'Failed to rename backup');
    }
}

async function revertRename(backupId: string, previousName: string) {
    try {
        await backupsStore.renameBackup(backupId, previousName);
        toastStore.success(`Backup name reverted to "${previousName}"`);
    } catch (error: any) {
        toastStore.error(error?.message || 'Failed to undo rename');
    }
}
</script>

<style scoped>
.brm__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
}
</style>

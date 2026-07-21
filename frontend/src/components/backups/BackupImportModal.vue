<template>
    <Modal :visible="visible" compact @close="onClose">
        <template #title>Import Backup</template>

        <div class="bki">
            <!-- File pick is the action: choosing a .zip starts the upload. -->
            <FileUploadField
                variant="dropzone"
                accept=".zip"
                upload-label="Click to choose a Shelly backup (.zip)"
                :file-name="fileName"
                :loading="busy"
                :show-delete="false"
                @upload="handleUpload"
            />

            <!-- Determinate upload progress (reuses the shared bar). -->
            <HorizontalProgress v-if="busy" :value="progress">
                <template #title>Uploading… {{ progress }}%</template>
            </HorizontalProgress>

            <!-- Inline error surfaces the backend validation reason. -->
            <p v-if="errorMessage" class="bki__error" role="alert">
                <i class="fas fa-circle-exclamation" aria-hidden="true" />
                {{ errorMessage }}
            </p>
        </div>

        <template #footer>
            <div class="bki__footer">
                <Button
                    type="blue-hollow"
                    size="sm"
                    :disabled="busy"
                    @click="onClose"
                >
                    Close
                </Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import FileUploadField from '@/components/core/FileUploadField.vue';
import HorizontalProgress from '@/components/core/HorizontalProgress.vue';
import Modal from '@/components/modals/Modal.vue';
import {useBackupsStore} from '@/stores/backups';
import {useToastStore} from '@/stores/toast';

const props = defineProps<{
    visible: boolean;
}>();

const emit = defineEmits<{
    close: [];
    imported: [];
}>();

const backupsStore = useBackupsStore();
const toastStore = useToastStore();

const busy = ref(false);
const progress = ref(0);
const fileName = ref('');
const errorMessage = ref('');

async function handleUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || busy.value) return;

    fileName.value = file.name;
    errorMessage.value = '';
    progress.value = 0;
    busy.value = true;

    try {
        await backupsStore.importBackup(file, undefined, (percent) => {
            progress.value = percent;
        });
        toastStore.success('Backup imported');
        emit('imported');
        emit('close');
        resetState();
    } catch (error) {
        // The store already maps the backend reason to friendly copy.
        errorMessage.value =
            error instanceof Error ? error.message : 'Failed to import backup.';
        toastStore.error(errorMessage.value);
    } finally {
        busy.value = false;
    }
}

function resetState() {
    busy.value = false;
    progress.value = 0;
    fileName.value = '';
    errorMessage.value = '';
}

function onClose() {
    if (busy.value) return;
    emit('close');
}

// Clear any prior error/file state each time the modal reopens.
watch(
    () => props.visible,
    (isVisible) => {
        if (!isVisible) resetState();
    }
);
</script>

<style scoped>
.bki {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}
.bki__error {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-3);
    background: var(--color-danger-subtle);
    border: 1px solid var(--color-danger);
    border-radius: var(--radius-md);
    color: var(--color-danger-text);
    font-size: var(--type-caption);
}
.bki__footer {
    display: flex;
    justify-content: flex-end;
    width: 100%;
}
</style>

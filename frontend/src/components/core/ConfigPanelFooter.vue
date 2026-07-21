<template>
    <div
        v-if="externalChanged"
        class="cfg-panel__notice cfg-panel__notice--split"
        role="alert"
    >
        <span>
            Configuration changed on the device while you were editing.
            Saving will overwrite those changes.
        </span>
        <Button type="blue-hollow" size="sm" @click="$emit('refresh')">
            Load latest
        </Button>
    </div>

    <div v-if="restartRequired" class="cfg-panel__reboot-banner">
        <span>Reboot required to apply {{ label }} changes.</span>
        <Button
            type="blue"
            size="sm"
            :loading="rebooting"
            @click="confirmReboot"
        >
            Reboot now
        </Button>
    </div>

    <footer v-if="dirty" class="cfg-panel__workspace-footer">
        <span class="cfg-panel__workspace-footer-copy">
            Unsaved {{ label }} changes
        </span>
        <Button type="blue" size="sm" :loading="saving" @click="$emit('save')">
            Save changes
        </Button>
    </footer>

    <ConfirmationModal ref="rebootConfirm" />
</template>

<script setup lang="ts">
import {ref} from 'vue';
import ConfirmationModal from '../modals/ConfirmationModal.vue';
import Button from './Button.vue';

defineProps<{
    /** Human name used in the footer copy, e.g. "Cloud" or "MQTT". */
    label: string;
    dirty: boolean;
    saving?: boolean;
    restartRequired?: boolean;
    rebooting?: boolean;
    externalChanged?: boolean;
}>();

const emit = defineEmits<{save: []; reboot: []; refresh: []}>();

const rebootConfirm = ref<InstanceType<typeof ConfirmationModal> | null>(null);

function confirmReboot(): void {
    rebootConfirm.value?.storeAction(() => emit('reboot'), {
        title: 'Reboot device?',
        message: 'The device will be unavailable briefly while it restarts.',
        confirmLabel: 'Reboot device'
    });
}
</script>

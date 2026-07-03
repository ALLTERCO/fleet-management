<template>
    <div class="adb">
        <Button
            type="blue"
            :size="size"
            requires-write
            aria-label="Add device"
            data-track="device_add_open"
            @click="visible = true"
        >
            <i class="fas fa-plus" aria-hidden="true" />
            <span v-if="!iconOnly">Add device</span>
        </Button>
        <AddDeviceWizard
            :visible="visible"
            @close="visible = false"
            @created="onCreated"
        />
    </div>
</template>

<script setup lang="ts">
import {ref} from 'vue';
import Button from '@/components/core/Button.vue';
import AddDeviceWizard from './AddDeviceWizard.vue';

withDefaults(
    defineProps<{
        size?: 'sm' | 'md';
        iconOnly?: boolean;
    }>(),
    {size: 'md', iconOnly: false}
);

const emit = defineEmits<{created: [externalId: string]}>();

const visible = ref(false);

function onCreated(externalId: string): void {
    visible.value = false;
    emit('created', externalId);
}
</script>

<style scoped>
.adb {
    display: inline-flex;
}
</style>

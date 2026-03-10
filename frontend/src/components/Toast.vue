<template>
    <div class="fixed top-4 right-4 left-auto bottom-auto w-full max-w-[350px]" style="z-index: var(--z-toast)" aria-live="polite" role="status">
        <Notification
            v-for="toast in toasts"
            v-show="toast.visible"
            :key="toast.message"
            :type="toast.type"
            class="transition-slow"
            >{{ toast.message }}</Notification
        >
    </div>
</template>

<script setup lang="ts">
import {storeToRefs} from 'pinia';
import {useToastStore} from '@/stores/toast';
import Notification from './core/Notification.vue';

const toastStore = useToastStore();
const {toasts} = storeToRefs(toastStore);
</script>

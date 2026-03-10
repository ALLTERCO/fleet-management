<template>
  <Widget class="relative overflow-visible hover:cursor-pointer w-full" style="max-width: 100%">
    <template #upper-corner>Action</template>
    <template #upper-right-corner>
      <button
        v-if="editMode"
        @click.stop="emit('duplicate')"
        class="absolute top-2 right-2 text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] z-20"
        title="Duplicate action"
      >
        <i class="fas fa-copy"></i>
      </button>
    </template>
    <template #name>{{ action.name }}</template>
    <template #description>{{ totalDevices }} device{{ totalDevices < 2 ? '' : 's' }}</template>
    <template #action>
      <template v-if="editMode">
        <div class="flex flex-col gap-2 w-full">
          <Button type="blue" size="sm" class="w-full" @click="emit('edit')">Edit</Button>
          <Button type="red" size="sm" class="w-full" @click="emit('delete')">Delete</Button>
        </div>
      </template>
      <button v-else class="w-10 h-10 rounded-full" :class="{
        'bg-[var(--color-primary)]': canExecute,
        'bg-[var(--color-surface-3)] cursor-not-allowed opacity-50': !canExecute,
      }" :disabled="!canExecute" @click.stop="clicked">
        <Spinner v-if="waitingForResponse" />
        <span v-else>Run</span>
      </button>
    </template>
  </Widget>
</template>

<script setup lang="ts">
import {computed, ref, toRef} from 'vue';
import {runAction} from '@/helpers/commands';
import {useAuthStore} from '@/stores/auth';
import {useToastStore} from '@/stores/toast';
import type {action_t} from '@/types';
import Button from '../core/Button.vue';
import Spinner from '../core/Spinner.vue';
import Widget from './WidgetsTemplates/VanilaWidget.vue';

const props = defineProps<{
    action: action_t;
    editMode?: boolean;
}>();

const emit = defineEmits<{
    delete: [];
    edit: [];
    duplicate: [];
}>();

const action = toRef(props, 'action');
const toastStore = useToastStore();
const authStore = useAuthStore();
const waitingForResponse = ref(false);

// Check if user can execute actions
const canExecute = computed(() => authStore.canExecuteActions());
const totalDevices = computed(() =>
    action.value.actions.reduce((acc, curr: any) => acc + curr.dst.length, 0)
);

async function clicked() {
    if (!canExecute.value) {
        toastStore.error('You do not have permission to execute actions');
        return;
    }
    waitingForResponse.value = true;
    try {
        await runAction(action.value);
    } catch {
        toastStore.error('Something went wrong with the action.');
    } finally {
        waitingForResponse.value = false;
    }
}
</script>

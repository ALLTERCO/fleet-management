<template>
    <div class="flex flex-row items-center justify-center gap-1 px-1.5">
        <!-- Disable the button while waiting for the request to complete or it is in that position already -->
        <button
            class="cover-btn group disabled:cursor-not-allowed rounded-full flex"
            :disabled="disabled || requestInProgress || state === 'open'"
            @click.stop="setDirection('open')"
        >
            <!-- Replace the error icon with pause button while moving in that direction -->
            <span v-if="state === 'opening'" class="w-11 h-11 flex items-center justify-center">
                <i class="cover-icon fas fa-solid fa-pause"></i>
            </span>
            <span v-else class="w-11 h-11 flex items-center justify-center">
                <i class="cover-icon fas fa-solid fa-chevron-up"></i>
            </span>
        </button>

        <!-- Disable the button while waiting for the request to complete or it is in that position already -->
        <button
            class="cover-btn group disabled:cursor-not-allowed rounded-full flex"
            :disabled="disabled || requestInProgress || state === 'closed'"
            @click.stop="setDirection('close')"
        >
            <!-- Replace the error icon with pause button while moving in that direction -->
            <span v-if="state === 'closing'" class="w-11 h-11 flex items-center justify-center">
                <i class="cover-icon fas fa-solid fa-pause"></i>
            </span>
            <span v-else class="w-11 h-11 flex items-center justify-center">
                <i class="cover-icon fas fa-solid fa-chevron-down"></i>
            </span>
        </button>
    </div>
</template>

<script setup lang="ts">
import {ref, toRefs} from 'vue';

const props = withDefaults(
    defineProps<{
        state: 'open' | 'closed' | 'opening' | 'closing' | 'stopped';
        requestInProgress: boolean;
        disabled?: boolean;
    }>(),
    {
        disabled: false
    }
);
const {state, requestInProgress, disabled} = toRefs(props);
const lastDirection = ref<'close' | 'open' | 'stop'>('stop');
const emit = defineEmits<{
    direction: [direction: 'stop' | 'open' | 'close'];
}>();

function setDirection(direction: 'stop' | 'open' | 'close') {
    if (state.value !== 'stopped' && direction === lastDirection.value) {
        direction = 'stop';
    }

    lastDirection.value = direction;
    emit('direction', direction);
}
</script>

<style scoped>
.cover-btn {
    background-color: var(--color-text-primary);
}
.cover-icon {
    color: var(--color-text-inverse);
}
.cover-btn:disabled .cover-icon {
    color: var(--color-text-disabled);
}
</style>

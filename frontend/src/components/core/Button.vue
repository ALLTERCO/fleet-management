<template>
    <button
        class="core-btn text-center shadow select-none bg-gradient-to-l hover:cursor-pointer hover:transition-all hover:duration-100"
        :class="classColor"
        :disabled="isDisabled"
        :title="disabledReason"
        :type="submit ? 'submit' : 'button'"
        @click="(event) => !loading && !isDisabled && emit('click', event)"
    >
        <div v-if="loading" class="w-full flex flex-row justify-center items-center">
            <Spinner size="xs" class="m-auto" />
        </div>
        <slot v-else />
    </button>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {usePermissions} from '@/composables/usePermissions';
import Spinner from './Spinner.vue';

const {canWrite} = usePermissions();

const props = withDefaults(
    defineProps<{
        type?: 'green' | 'red' | 'blue' | 'blue-hollow' | 'white' | 'orange';
        size?: 'xs' | 'sm' | 'md' | 'lg';
        narrow?: boolean;
        loading?: boolean;
        disabled?: boolean;
        submit?: boolean;
        /** If true, button will be disabled for users without write permission */
        requiresWrite?: boolean;
    }>(),
    {
        type: 'blue',
        size: 'md',
        requiresWrite: false
    }
);

// Computed disabled state that includes permission check
const isDisabled = computed(() => {
    if (props.disabled) return true;
    if (props.requiresWrite && !canWrite.value) return true;
    return false;
});

// Tooltip reason for disabled state
const disabledReason = computed(() => {
    if (props.requiresWrite && !canWrite.value) {
        return 'You do not have permission to perform this action';
    }
    return undefined;
});

const emit = defineEmits<{
    click: [event: MouseEvent];
}>();

const classColor = computed(() => {
    const classes = [
        props.type !== 'white' ? `btn-${props.type}` : 'btn-white'
    ];
    if (props.size == 'xs') {
        classes.push('core-btn--xs py-1 px-3 min-h-[var(--touch-target-min)]');
    } else if (props.size == 'sm') {
        classes.push('py-2 px-3 min-h-[var(--touch-target-min)]');
    } else if (props.size == 'md') {
        classes.push('py-2.5', 'px-4');
    } else if (props.size == 'lg') {
        classes.push('core-btn--lg py-3 px-6');
    }

    if (props.narrow) {
        classes.push('min-w-[var(--touch-target-min)]');
    } else {
        classes.push('min-w-[var(--btn-min-width)]');
    }

    if (props.loading) {
        classes.push('hover:cursor-not-allowed');
    }

    if (isDisabled.value) {
        classes.push(
            '!bg-none !border-none',
            '!bg-opacity-25',
            '!shadow-none',
            'hover:!cursor-not-allowed'
        );
    }

    return classes;
});
</script>

<style scoped>
.core-btn {
    color: var(--color-text-primary);
    border-radius: var(--btn-radius);
    font-weight: var(--btn-font-weight);
    font-size: var(--btn-font-size);
    transition: transform var(--duration-fast) var(--ease-default),
                background-color var(--duration-fast) var(--ease-default);
}
.core-btn--xs { font-size: var(--btn-font-size-xs); }
.core-btn--lg { font-size: var(--btn-font-size-lg); }
.core-btn:active:not(:disabled) {
    transform: scale(0.97);
}
.btn-white {
    background-color: var(--color-text-primary);
    color: var(--color-text-inverse);
}
.btn-white:hover {
    opacity: 0.9;
}
.btn-blue-hollow {
    border: 2px solid var(--color-primary);
    background: transparent;
}
.btn-blue-hollow:hover {
    background-color: var(--color-primary-subtle);
}
.btn-blue {
    background: linear-gradient(to left, var(--color-primary-active), var(--color-primary));
    box-shadow: var(--shadow-primary);
}
.btn-blue:hover {
    background: linear-gradient(to left, var(--color-primary-active), var(--color-primary-hover));
}
.btn-red {
    background: linear-gradient(to left, var(--color-danger-subtle), var(--color-danger));
    box-shadow: var(--shadow-danger);
}
.btn-red:hover {
    background: linear-gradient(to left, var(--color-danger-subtle), var(--color-danger-hover));
}
.btn-green {
    background: linear-gradient(to left, var(--color-success-subtle), var(--color-success));
    box-shadow: var(--shadow-success);
}
.btn-green:hover {
    background: linear-gradient(to left, var(--color-success-subtle), var(--color-success-hover));
}
.btn-orange {
    background: linear-gradient(to left, var(--color-orange-subtle), var(--color-orange));
    box-shadow: var(--shadow-orange);
}
.btn-orange:hover {
    background: linear-gradient(to left, var(--color-orange-subtle), var(--color-orange-hover));
}
</style>

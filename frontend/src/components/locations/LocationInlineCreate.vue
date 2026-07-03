<template>
    <div class="lic" :style="indentStyle">
        <i class="fas fa-plus lic__icon" aria-hidden="true" />
        <input
            ref="inputRef"
            v-model="name"
            type="text"
            class="lic__input"
            :placeholder="placeholder"
            :disabled="submitting"
            :aria-label="placeholder"
            @keydown.enter.prevent="onSubmit"
            @keydown.escape.prevent="onCancel"
            @blur="onBlur"
        />
        <span v-if="submitting" class="lic__hint">
            <i class="fas fa-spinner fa-spin" aria-hidden="true" />
        </span>
        <span v-else-if="error" class="lic__error" role="alert">
            {{ error }}
        </span>
    </div>
</template>

<script setup lang="ts">
import {computed, nextTick, onMounted, ref} from 'vue';
import type {LocationKind} from '@/stores/locations';
import {useLocationsStore} from '@/stores/locations';
import {trackInteraction} from '@/tools/observability';

const props = withDefaults(
    defineProps<{
        parentId: number | null;
        defaultKind: LocationKind;
        depth?: number;
    }>(),
    {depth: 0}
);

const emit = defineEmits<{
    created: [id: number];
    cancel: [];
}>();

const store = useLocationsStore();

const inputRef = ref<HTMLInputElement | null>(null);
const name = ref('');
const submitting = ref(false);
const error = ref<string | null>(null);

onMounted(() => {
    void nextTick(() => inputRef.value?.focus());
});

const indentStyle = computed(() => ({
    paddingLeft: `calc(var(--gap-md) + ${props.depth} * var(--space-5))`
}));

const placeholder = computed(() => `New ${props.defaultKind} — type a name`);

async function onSubmit(): Promise<void> {
    const trimmed = name.value.trim();
    if (trimmed.length === 0) {
        emit('cancel');
        return;
    }
    submitting.value = true;
    error.value = null;
    try {
        const created = await store.createLocation({
            name: trimmed,
            kind: props.defaultKind,
            parentLocationId: props.parentId
        });
        if (created) {
            trackInteraction('locations', 'inline_create_submit', 'success');
            emit('created', created.id);
        } else {
            trackInteraction('locations', 'inline_create_submit', 'failure');
            error.value = 'Could not create location.';
        }
    } finally {
        submitting.value = false;
    }
}

function onCancel(): void {
    emit('cancel');
}

function onBlur(): void {
    if (submitting.value) return;
    if (name.value.trim().length === 0) emit('cancel');
}
</script>

<style scoped>
.lic {
    --lt-depth: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--gap-md);
    border: 1px dashed var(--color-border-medium);
    border-radius: var(--radius-md);
    background: rgba(var(--color-primary-rgb), 0.04);
}

.lic__icon {
    width: var(--icon-size-sm);
    text-align: center;
    color: var(--color-primary);
    flex-shrink: 0;
}

.lic__input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: 0;
    outline: none;
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-family: inherit;
    padding: 0;
}

.lic__input::placeholder {
    color: var(--color-text-tertiary);
}

.lic__hint {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.lic__error {
    font-size: var(--type-caption);
    color: var(--color-status-off);
}
</style>

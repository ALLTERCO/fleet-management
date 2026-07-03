<template>
    <div class="et-text">
        <!-- Current value display -->
        <div v-if="view === 'image' && safeImageSrc" class="et-text__image">
            <img :src="safeImageSrc" alt="Virtual text image" class="et-text__img" />
        </div>
        <div v-else class="et-text__value-card">
            <span class="et-text__value">{{ status?.value ?? 'N/A' }}</span>
        </div>

        <!-- Editable field -->
        <form v-if="canExecute && view === 'field'" class="et-text__field" @submit.prevent="submitValue">
            <input
                v-model="inputValue"
                type="text"
                class="et-text__input"
                :maxlength="maxLength"
                placeholder="Enter value..."
            />
            <button type="submit" class="et-text__submit">Set</button>
        </form>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    view?: string;
    maxLength?: number;
}>();

const emit = defineEmits<{
    set: [value: string];
}>();

const maxLength = computed(() => props.maxLength ?? 256);

/** Only allow http(s) URLs for device-controlled image source */
const safeImageSrc = computed(() => {
    const val = props.status?.value;
    if (typeof val !== 'string') return undefined;
    if (val.startsWith('https://') || val.startsWith('http://')) return val;
    return undefined;
});

const inputValue = ref(props.status?.value ?? '');
watch(
    () => props.status?.value,
    (v) => {
        inputValue.value = v ?? '';
    }
);

function submitValue() {
    emit('set', inputValue.value);
}
</script>

<style scoped>
.et-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.et-text__value-card {
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
    text-align: center;
}
.et-text__value {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    word-break: break-word;
}

/* Image view */
.et-text__image {
    border-radius: var(--radius-md);
    overflow: hidden;
    background-color: var(--color-surface-2);
}
.et-text__img {
    width: 100%;
    max-height: 200px;
    object-fit: contain;
}

/* Field input */
.et-text__field {
    display: flex;
    gap: var(--space-1-5);
}
.et-text__input {
    flex: 1;
    padding: var(--space-1-5) var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
    font-size: var(--type-body);
}
.et-text__input:focus {
    outline: none;
    border-color: var(--color-primary);
}
.et-text__submit {
    padding: var(--space-1-5) var(--space-3);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-primary);
    background-color: color-mix(in srgb, var(--color-primary) 15%, transparent);
    color: var(--color-primary);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default);
}
.et-text__submit:hover {
    background-color: color-mix(in srgb, var(--color-primary) 25%, transparent);
}
</style>

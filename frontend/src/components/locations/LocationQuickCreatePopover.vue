<template>
    <Modal :visible="modelValue" @close="onCancel">
        <template #title>
            <span class="lqc-title">
                <i class="fas fa-plus lqc-title-icon" aria-hidden="true" />
                New location
            </span>
        </template>
        <template #default>
            <form class="lqc" @submit.prevent="onSubmit">
                <label class="lqc__field">
                    <span class="lqc__label">Name</span>
                    <input
                        ref="nameInputRef"
                        v-model="name"
                        type="text"
                        class="lqc__input"
                        placeholder="e.g. Sofia HQ"
                        :disabled="submitting"
                        @keydown.escape.prevent="onCancel"
                    />
                </label>

                <label class="lqc__field">
                    <span class="lqc__label">Parent</span>
                    <select
                        v-model.number="parentId"
                        class="lqc__select"
                        :disabled="submitting"
                    >
                        <option :value="null">Top level</option>
                        <option
                            v-for="choice in parentChoices"
                            :key="choice.id"
                            :value="choice.id"
                        >
                            {{ choice.label }}
                        </option>
                    </select>
                </label>

                <label class="lqc__field">
                    <span class="lqc__label">Kind</span>
                    <select
                        v-model="kind"
                        class="lqc__select"
                        :disabled="submitting"
                    >
                        <option
                            v-for="entry in kindChoices"
                            :key="entry.kind"
                            :value="entry.kind"
                        >
                            {{ entry.label }}
                        </option>
                    </select>
                </label>

                <p v-if="error" class="lqc__error" role="alert">{{ error }}</p>

                <footer class="lqc__footer">
                    <Button
                        type="white"
                        size="sm"
                        :disabled="submitting"
                        @click="onCancel"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="green"
                        size="sm"
                        :disabled="submitting || name.trim().length === 0"
                        @click="onSubmit"
                    >
                        <i v-if="submitting" class="fas fa-spinner fa-spin" />
                        <span v-else>Create</span>
                    </Button>
                </footer>
            </form>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {computed, nextTick, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Modal from '@/components/modals/Modal.vue';
import {buildTree} from '@/helpers/locationTree';
import type {LocationKind} from '@/stores/locations';
import {useLocationsStore} from '@/stores/locations';

const props = withDefaults(
    defineProps<{
        modelValue: boolean;
        defaultParentId?: number | null;
        defaultKind?: LocationKind;
    }>(),
    {defaultParentId: null, defaultKind: 'site'}
);

const emit = defineEmits<{
    'update:modelValue': [next: boolean];
    created: [id: number];
}>();

const store = useLocationsStore();

const name = ref('');
const parentId = ref<number | null>(props.defaultParentId);
const kind = ref<LocationKind>(props.defaultKind);
const submitting = ref(false);
const error = ref<string | null>(null);

const nameInputRef = ref<HTMLInputElement | null>(null);

// Reset state on every open so a fresh create starts blank.
watch(
    () => props.modelValue,
    (next) => {
        if (!next) return;
        name.value = '';
        parentId.value = props.defaultParentId;
        kind.value = props.defaultKind;
        error.value = null;
        void nextTick(() => nameInputRef.value?.focus());
    }
);

interface ParentChoice {
    readonly id: number;
    readonly label: string;
}

const parentChoices = computed<ParentChoice[]>(() => {
    const flat: ParentChoice[] = [];
    function walk(nodes: ReturnType<typeof buildTree>): void {
        for (const n of nodes) {
            const prefix = n.depth === 0 ? '' : `${'  '.repeat(n.depth - 1)}└ `;
            flat.push({id: n.location.id, label: `${prefix}${n.location.name}`});
            walk(n.children);
        }
    }
    walk(buildTree(store.locations));
    return flat;
});

interface KindChoice {
    readonly kind: LocationKind;
    readonly label: string;
}

const kindChoices = computed<KindChoice[]>(() =>
    store.kinds.map((k) => ({kind: k.kind, label: k.label}))
);

async function onSubmit(): Promise<void> {
    const trimmed = name.value.trim();
    if (trimmed.length === 0) return;
    submitting.value = true;
    error.value = null;
    try {
        const created = await store.createLocation({
            name: trimmed,
            kind: kind.value,
            parentLocationId: parentId.value
        });
        if (created) {
            emit('created', created.id);
            emit('update:modelValue', false);
        } else {
            error.value = 'Could not create location.';
        }
    } finally {
        submitting.value = false;
    }
}

function onCancel(): void {
    if (submitting.value) return;
    emit('update:modelValue', false);
}
</script>

<style scoped>
.lqc-title {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-subheading);
    font-weight: var(--font-semibold);
}

.lqc-title-icon {
    color: var(--color-primary);
}

.lqc {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.lqc__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.lqc__label {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.02em;
    font-weight: var(--font-medium);
}

.lqc__input,
.lqc__select {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-family: inherit;
    outline: none;
    transition:
        border-color var(--duration-fast),
        background var(--duration-fast);
}

.lqc__input:focus,
.lqc__select:focus {
    border-color: var(--color-primary);
    background: var(--color-surface-2);
}

.lqc__error {
    margin: 0;
    color: var(--color-status-off);
    font-size: var(--type-caption);
}

.lqc__footer {
    display: flex;
    gap: var(--space-2);
    justify-content: flex-end;
    margin-top: var(--space-2);
}
</style>

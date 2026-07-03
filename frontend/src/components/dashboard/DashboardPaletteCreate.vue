<template>
    <div class="dpc">
        <div class="dpc__header">
            <button class="dpc__back" aria-label="Back to list" @click="$emit('cancel')">
                <i class="fas fa-arrow-left" />
            </button>
            <h4 class="dpc__title">Create dashboard</h4>
        </div>

        <div class="dpc__field">
            <label class="dpc__label">Type</label>
            <div class="dpc__types">
                <button
                    v-for="option in TYPE_OPTIONS"
                    :key="option.key"
                    class="dpc-type"
                    :class="{'dpc-type--selected': selected === option.key}"
                    @click="selectType(option.key)"
                >
                    <i :class="['dpc-type__icon', option.icon]" />
                    <span class="dpc-type__label">{{ option.label }}</span>
                </button>
            </div>
            <p v-if="selectedMeta" class="dpc__hint">{{ selectedMeta.description }}</p>
        </div>

        <div class="dpc__field">
            <label class="dpc__label" for="dpc-name">Name</label>
            <input
                id="dpc-name"
                ref="nameInput"
                v-model="name"
                class="dpc__name"
                type="text"
                :placeholder="placeholderName"
                spellcheck="false"
                autocomplete="off"
                @keydown.enter.stop.prevent="submit"
                @keydown.esc.stop.prevent="$emit('cancel')"
            />
        </div>

        <div class="dpc__actions">
            <button class="dpc__btn dpc__btn--ghost" @click="$emit('cancel')">Cancel</button>
            <button
                class="dpc__btn dpc__btn--primary"
                :disabled="!canSubmit"
                @click="submit"
            >
                <i v-if="creating" class="fas fa-spinner fa-spin" />
                {{ creating ? 'Creating…' : 'Create' }}
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from 'vue';
import {DOMAIN_TYPE_META, type DomainDashboardType} from '@/types/dashboard';

export type CreatableType = 'classic' | DomainDashboardType;

export interface CreateSubmitPayload {
    readonly type: CreatableType;
    readonly name: string;
}

interface TypeOption {
    key: CreatableType;
    label: string;
    icon: string;
    defaultName: string;
    description: string;
}

// Domain dashboard types offered in the create picker. Only Energy is enabled
// for now (alongside Classic below). The other domain types are intentionally
// HIDDEN here — commented out, not deleted — so they stay creatable-ready and,
// crucially, remain in the global DOMAIN_TYPES so existing dashboards of those
// kinds still route and render. To re-enable one in the picker, uncomment it.
const CREATABLE_DOMAIN_TYPES: readonly DomainDashboardType[] = [
    'energy'
    // 'overview',
    // 'environment',
    // 'control',
    // 'safety',
    // 'map'
];

const TYPE_OPTIONS: readonly TypeOption[] = [
    {
        key: 'classic',
        label: 'Classic',
        icon: 'fas fa-table-cells-large',
        defaultName: 'New Dashboard',
        description:
            'Empty grid you fill with widgets — pin devices, charts, and KPIs.'
    },
    ...CREATABLE_DOMAIN_TYPES.map(
        (type): TypeOption => ({
            key: type,
            label: DOMAIN_TYPE_META[type].label,
            icon: DOMAIN_TYPE_META[type].icon,
            defaultName: DOMAIN_TYPE_META[type].defaultName,
            description: DOMAIN_TYPE_META[type].description
        })
    )
];

const props = defineProps<{
    seedName: string;
    creating: boolean;
}>();

const emit = defineEmits<{
    (e: 'submit', payload: CreateSubmitPayload): void;
    (e: 'cancel'): void;
}>();

const selected = ref<CreatableType>('classic');
const name = ref(props.seedName);
const nameInput = ref<HTMLInputElement | null>(null);

const selectedMeta = computed(() =>
    TYPE_OPTIONS.find((opt) => opt.key === selected.value)
);

const placeholderName = computed(
    () => selectedMeta.value?.defaultName ?? 'New Dashboard'
);

const canSubmit = computed(() => !props.creating);

onMounted(async () => {
    await nextTick();
    nameInput.value?.focus();
    nameInput.value?.select();
});

// Refocus the name input when the parent flips creating false again —
// covers the failed-submit case: store toasts, palette stays open, user
// should be able to fix the name and retry without re-clicking.
watch(
    () => props.creating,
    async (busy, wasBusy) => {
        if (wasBusy && !busy) {
            await nextTick();
            nameInput.value?.focus();
            nameInput.value?.select();
        }
    }
);

watch(
    () => props.seedName,
    (next) => {
        if (name.value.length === 0) name.value = next;
    }
);

function selectType(key: CreatableType): void {
    selected.value = key;
}

function submit(): void {
    if (!canSubmit.value) return;
    const draft = name.value.trim();
    const final = draft.length > 0 ? draft : placeholderName.value;
    emit('submit', {type: selected.value, name: final});
}
</script>

<style scoped>
.dpc {
    padding: var(--space-2) var(--space-3) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.dpc__header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.dpc__back {
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default);
}

.dpc__back:hover {
    background-color: var(--glass-hover);
    color: var(--color-text-primary);
}

.dpc__title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.dpc__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
}

.dpc__label {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-tertiary);
}

.dpc__types {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2);
}

.dpc-type {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-3) var(--space-2);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition:
        background-color var(--duration-fast) var(--ease-default),
        border-color var(--duration-fast) var(--ease-default),
        color var(--duration-fast) var(--ease-default);
}

.dpc-type:hover {
    border-color: var(--color-primary);
    background-color: var(--glass-hover);
    color: var(--color-text-primary);
}

.dpc-type--selected {
    border-color: var(--color-primary);
    background-color: var(--color-primary-subtle);
    color: var(--color-primary-text);
}

.dpc-type__icon {
    font-size: var(--icon-size-md);
}

.dpc-type__label {
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
}

.dpc__hint {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.dpc__name {
    background: var(--glass-input);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    padding: var(--space-2) var(--space-3);
    outline: none;
    transition: border-color var(--duration-fast) var(--ease-default);
}

.dpc__name:focus {
    border-color: var(--color-primary);
}

.dpc__actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-2);
}

.dpc__btn {
    min-height: var(--touch-target-min);
    padding: 0 var(--space-4);
    border-radius: var(--radius-md);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    cursor: pointer;
    border: 1px solid transparent;
    transition:
        background-color var(--duration-fast) var(--ease-default),
        border-color var(--duration-fast) var(--ease-default);
}

.dpc__btn--ghost {
    background: transparent;
    color: var(--color-text-secondary);
    border-color: var(--color-border-default);
}

.dpc__btn--ghost:hover {
    background: var(--glass-hover);
    color: var(--color-text-primary);
}

.dpc__btn--primary {
    background: var(--color-primary);
    color: var(--color-text-inverse);
}

.dpc__btn--primary:hover:not(:disabled) {
    background: var(--color-primary-hover);
}

.dpc__btn--primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
</style>

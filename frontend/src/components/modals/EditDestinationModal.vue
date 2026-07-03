<template>
    <Modal :visible="visible" @close="close">
        <template #title>
            <ModalHeader
                :icon="props.mode === 'create' ? 'fa-plus' : 'fa-pen'"
                :title="headerTitle"
                :description="headerDescription"
            />
        </template>

        <template #default>
            <form class="edm" autocomplete="off" @submit.prevent="handleSave">
                <div class="edm__field">
                    <label class="edm__label" :for="nameId">
                        Name
                        <span class="edm__required" aria-hidden="true">*</span>
                    </label>
                    <Input
                        :id="nameId"
                        v-model="formName"
                        placeholder="e.g. Ops on-call"
                        @blur="syncNameError"
                    />
                    <p v-if="nameError" class="edm__error" role="alert">
                        <i class="fas fa-circle-exclamation" />
                        {{ nameError }}
                    </p>
                    <p v-else class="edm__hint">
                        Shown when assigning this destination group to alert rules.
                    </p>
                </div>

                <div class="edm__field">
                    <label class="edm__label" :for="descId">Description</label>
                    <Input
                        :id="descId"
                        v-model="formDescription"
                        placeholder="Optional — who this group notifies, when to use it"
                    />
                </div>

                <div class="edm__field">
                    <Checkbox
                        v-model="formEnabled"
                        label="Enabled"
                        hint="Disabled groups are never notified, even if rules target them."
                    />
                </div>
            </form>
        </template>

        <template #footer>
            <ModalFooter>
                <template v-if="justSaved" #meta>
                    <span class="edm__flash">
                        <i class="fas fa-circle-check" />
                        {{ props.mode === 'create' ? 'Destination created' : 'Changes saved' }}
                    </span>
                </template>
                <template #secondary>
                    <Button type="blue-hollow" @click="close">Cancel</Button>
                </template>
                <template #primary>
                    <Button
                        type="blue"
                        :loading="saving"
                        :disabled="!canSave"
                        :requires-write="true"
                        @click="handleSave"
                    >
                        {{ primaryLabel }}
                    </Button>
                </template>
            </ModalFooter>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import type {DestinationGroup} from '@api/notification';
import {computed, ref, useId, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Checkbox from '@/components/core/Checkbox.vue';
import Input from '@/components/core/Input.vue';
import ModalFooter from '@/components/core/ModalFooter.vue';
import ModalHeader from '@/components/core/ModalHeader.vue';
import {useOptimisticSave} from '@/composables/useOptimisticSave';
import {useRequiredNameField} from '@/composables/useRequiredNameField';
import {useDestinationsStore} from '@/stores/destinations';
import Modal from './Modal.vue';

const visible = defineModel<boolean>({required: true});

const props = defineProps<{
    mode: 'create' | 'edit';
    initial?: DestinationGroup | null;
}>();

const emit = defineEmits<{saved: [DestinationGroup]}>();

const store = useDestinationsStore();

const nameId = useId();
const descId = useId();

const formName = ref('');
const formDescription = ref('');
const formEnabled = ref(true);

const {
    error: nameError,
    isValid: isNameValid,
    sync: syncNameError,
    reset: resetNameError
} = useRequiredNameField(formName);

const {saving, justSaved, runOptimisticSave} =
    useOptimisticSave<DestinationGroup>({
        onSuccess: (saved) => {
            emit('saved', saved);
            close();
        }
    });

const headerTitle = computed(() =>
    props.mode === 'create'
        ? 'New destination group'
        : `Edit "${props.initial?.name}"`
);

const headerDescription = computed(() =>
    props.mode === 'create'
        ? 'Bundle delivery targets — users, integration channels, push tokens — so rules can notify them together.'
        : 'Update the group\'s identity and enabled state.'
);

const primaryLabel = computed(() => {
    if (justSaved.value) {
        return props.mode === 'create' ? 'Created' : 'Saved';
    }
    if (saving.value) {
        return props.mode === 'create' ? 'Creating…' : 'Saving…';
    }
    return props.mode === 'create' ? 'Create destination' : 'Save changes';
});

const canSave = computed(
    () => !saving.value && isNameValid.value
);

watch(
    () => visible.value,
    (open) => {
        if (open) resetForm();
    },
    {immediate: true}
);

function resetForm() {
    const t = props.initial;
    formName.value = t?.name ?? '';
    formDescription.value = t?.description ?? '';
    formEnabled.value = t?.enabled ?? true;
    resetNameError();
}

function close() {
    visible.value = false;
}

async function handleSave() {
    syncNameError();
    if (saving.value || !isNameValid.value) return;
    await runOptimisticSave(persistDestination);
}

function persistDestination(): Promise<DestinationGroup | null> {
    const payload = {
        name: formName.value.trim(),
        description: formDescription.value.trim() || null,
        enabled: formEnabled.value
    };
    if (props.mode === 'create') {
        return store.createDestination(payload);
    }
    if (!props.initial) return Promise.resolve(null);
    return store.updateDestination(props.initial.id, payload);
}
</script>

<style scoped>
.edm {
    display: flex;
    flex-direction: column;
    gap: var(--form-section-gap);
}

.edm__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.edm__label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.edm__required {
    color: var(--color-danger-text);
    margin-left: var(--space-0-5);
}

.edm__error {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-danger-text);
    line-height: 1.4;
}

.edm__hint {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    line-height: 1.4;
}

.edm__flash {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-success-text);
    font-weight: var(--font-semibold);
    animation: edm-flash-in var(--duration-normal) var(--ease-out);
}

@keyframes edm-flash-in {
    from {
        opacity: 0;
        transform: translateY(-2px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}
</style>

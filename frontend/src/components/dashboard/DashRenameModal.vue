<template>
    <Modal :visible="visible" compact @close="emit('close')">
        <template #title>
            <span class="drn-title">Rename dashboard</span>
        </template>

        <template #default>
            <!-- Enter-to-save binds here, not on <Input>: Input renders multiple
                 roots, so a fallthrough listener on it is silently dropped. -->
            <div class="drn" @keydown.enter="onSave">
                <label class="drn-label" for="drn-name">Name</label>
                <Input
                    id="drn-name"
                    v-model="draft"
                    :maxlength="NAME_MAX_LENGTH"
                    placeholder="Dashboard name"
                    aria-label="Dashboard name"
                />
            </div>
        </template>

        <template #footer>
            <div class="drn-footer">
                <Button type="blue-hollow" @click="emit('close')">Cancel</Button>
                <Button
                    type="green"
                    :loading="saving"
                    :disabled="!canSave"
                    @click="onSave"
                >
                    Save
                </Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Input from '@/components/core/Input.vue';
import Modal from '@/components/modals/Modal.vue';
import {NAME_MAX_LENGTH} from '@/helpers/validation-limits';

const props = defineProps<{
    visible: boolean;
    name: string;
    saving?: boolean;
}>();

const emit = defineEmits<{
    save: [name: string];
    close: [];
}>();

const draft = ref(props.name);

// Reseed the field each time the dialog opens so a prior edit never leaks in.
watch(
    () => props.visible,
    (open) => {
        if (open) draft.value = props.name;
    }
);

const canSave = computed(() => {
    const trimmed = draft.value.trim();
    return (
        !props.saving &&
        trimmed.length > 0 &&
        trimmed !== props.name.trim()
    );
});

function onSave(): void {
    if (!canSave.value) return;
    emit('save', draft.value.trim());
}
</script>

<style scoped>
.drn-title {
    font-size: var(--type-subheading);
    font-weight: var(--font-semibold);
}
.drn {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.drn-label {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
}
.drn-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
}
</style>

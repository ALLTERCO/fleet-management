<template>
    <section
        v-if="row"
        class="ua-review"
        aria-labelledby="assignment-removal-title"
    >
        <div>
            <h3 id="assignment-removal-title" ref="removalHeading" tabindex="-1">
                Remove assignment
            </h3>
            <p>
                <strong dir="auto">{{ tariffName(tariffs, row.tariffId) }}</strong>
                stops being the {{ row.direction }} tariff for
                {{ assignmentScope(row).toLowerCase() }}.
                Points that used it fall back to a wider assignment, or stay
                unpriced when no wider assignment applies.
            </p>
        </div>
        <p v-if="removeError" class="ua-form-error" role="alert">{{ removeError }}</p>
        <div class="ua-editor__footer">
            <Button type="blue-hollow" size="sm" @click="emit('cancel')">Back</Button>
            <Button type="red" size="sm" :loading="removing" @click="confirmRemoval">
                Remove assignment
            </Button>
        </div>
    </section>
</template>

<script setup lang="ts">
import {nextTick, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useToastStore} from '@/stores/toast';
import {
    type Assignment,
    assignmentScope,
    type Tariff,
    tariffName,
    titleCase
} from './tariffAssignmentView';
import {removeAssignment} from './tariffAssignmentWrites';

const props = defineProps<{
    /** The assignment awaiting confirmation, or null while none is. */
    row: Assignment | null;
    tariffs: Tariff[];
    canWrite: boolean;
}>();

const emit = defineEmits<{cancel: []; removed: []}>();

// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const toast = useToastStore();

const removing = ref(false);
const removeError = ref('');
const removalHeading = ref<HTMLElement | null>(null);

// The row that opens this panel can sit far below it.
watch(
    () => props.row,
    (row) => {
        removeError.value = '';
        if (row) void nextTick(() => removalHeading.value?.focus());
    }
);

async function confirmRemoval(): Promise<void> {
    const row = props.row;
    if (!props.canWrite || removing.value || row === null) return;
    removing.value = true;
    removeError.value = '';
    try {
        await applyRemoval(row);
    } catch (error) {
        removeError.value = rpcErrorMessage(
            error,
            'Could not remove the assignment'
        );
    } finally {
        removing.value = false;
    }
}

// The panel owns the list, so it reloads once the removal lands.
async function applyRemoval(row: Assignment): Promise<void> {
    await removeAssignment(row);
    toast.success(`${titleCase(row.direction)} tariff assignment removed`);
    emit('removed');
}
</script>

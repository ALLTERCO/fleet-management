<template>
    <div class="bob">
        <Button
            v-for="op in ops"
            :key="op.id"
            :type="op.variant ?? 'blue-hollow'"
            size="sm"
            :disabled="busy || selected.length === 0"
            :loading="busy && activeOp?.id === op.id"
            @click="start(op)"
        >
            {{ op.label }}
        </Button>

        <Modal :visible="pickerVisible" @close="cancelPicker">
            <template #title><h3>{{ activeOp?.label }}</h3></template>
            <SubjectPicker
                v-if="activePickerType"
                v-model="picks"
                :subject-types="[activePickerType]"
                :multiple="activeOp?.pickerMultiple ?? false"
            />
            <template #footer>
                <Button type="blue-hollow" size="sm" @click="cancelPicker">Cancel</Button>
                <Button
                    type="blue"
                    size="sm"
                    :disabled="picks.length === 0 || busy"
                    :loading="busy"
                    @click="confirmPicks"
                >Apply</Button>
            </template>
        </Modal>

        <ConfirmationModal ref="confirmRef">
            <template #title><h3>{{ confirmTitle }}</h3></template>
            <template v-if="confirmBody" #subText>
                <p class="bob-confirm-body">{{ confirmBody }}</p>
            </template>
        </ConfirmationModal>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import Button from '@/components/core/Button.vue';
import SubjectPicker, {
    type SubjectRef,
    type SubjectType
} from '@/components/core/SubjectPicker.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import Modal from '@/components/modals/Modal.vue';

export interface BatchOp {
    id: string;
    label: string;
    icon: string;
    variant?: 'blue-hollow' | 'red' | 'blue' | 'green' | 'orange' | 'white';
    picker?: SubjectType;
    pickerMultiple?: boolean;
    confirm?: (
        ids: string[],
        pick: SubjectRef[]
    ) => {title: string; body?: string};
    // Return false to signal failure — bar keeps selection. void/true = success.
    run: (ids: string[], pick: SubjectRef[]) => Promise<boolean | undefined>;
}

const props = defineProps<{
    selected: string[];
    ops: BatchOp[];
}>();

const emit = defineEmits<{done: []}>();

const busy = ref(false);
const activeOp = ref<BatchOp | null>(null);
const pickerVisible = ref(false);
const picks = ref<SubjectRef[]>([]);
const confirmRef = ref<InstanceType<typeof ConfirmationModal>>();
const confirmTitle = ref('');
const confirmBody = ref<string | undefined>(undefined);

const activePickerType = computed<SubjectType | undefined>(
    () => activeOp.value?.picker
);

function start(op: BatchOp) {
    if (busy.value || props.selected.length === 0) return;
    activeOp.value = op;
    picks.value = [];
    if (op.picker) {
        pickerVisible.value = true;
        return;
    }
    void proceed([]);
}

function cancelPicker() {
    pickerVisible.value = false;
    activeOp.value = null;
    picks.value = [];
}

async function confirmPicks() {
    if (picks.value.length === 0) return;
    pickerVisible.value = false;
    await proceed(picks.value);
}

async function proceed(finalPicks: SubjectRef[]) {
    const op = activeOp.value;
    if (!op) return;
    if (op.confirm) {
        const {title, body} = op.confirm(props.selected, finalPicks);
        confirmTitle.value = title;
        confirmBody.value = body;
        confirmRef.value?.storeAction(() => runOp(op, finalPicks));
        return;
    }
    await runOp(op, finalPicks);
}

async function runOp(op: BatchOp, finalPicks: SubjectRef[]) {
    busy.value = true;
    try {
        const ok = await op.run(props.selected, finalPicks);
        if (ok !== false) emit('done');
    } finally {
        busy.value = false;
        activeOp.value = null;
        picks.value = [];
    }
}
</script>

<style scoped>
.bob {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
}
.bob-confirm-body {
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}
</style>

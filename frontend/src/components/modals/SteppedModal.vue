<template>
    <Modal :visible="visible" @close="close">
        <template #title>
            <span>
                <slot name="title" />
            </span>
            <div class="text-base font-semibold mt-4">
                <Steps :current="stage" :steps="maxSteps" @click="(selected) => fastforward(selected)">
                    <template #stepTitle="{ id }">
                        <slot name="stepTitle" :stage="id" />
                    </template>
                </Steps>
            </div>
        </template>
        <template #default>
            <slot :stage />
        </template>
        <template #footer>
            <div class="flex flex-row-reverse gap-4">
                <Button v-if="stage !== maxSteps" type="blue" @click="next"
                    >Next <i class="fas fa-chevron-right"
                /></Button>
                <Button v-else type="blue" :requires-write="requiresWrite" @click="save">Save <i class="fas fa-save" /></Button>
                <Button v-if="stage > 1" type="blue-hollow" @click="prev">
                    <i class="fas fa-chevron-left" /> Back
                </Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Steps from '@/components/core/Steps.vue';
import Modal from '@/components/modals/Modal.vue';

const stage = defineModel<number>('stage', {required: true});
const visible = defineModel<boolean>('visible', {required: true});

defineProps<{
    maxSteps: number;
    /** If true, the Save button will be disabled for users without write permission */
    requiresWrite?: boolean;
}>();

const emit = defineEmits<{
    next: [];
    save: [];
    back: [];
    close: [];
    onchange: [stage: number];
}>();

function fastforward(to: number) {
    stage.value = to;
    emit('next');
}

function next() {
    stage.value++;
    emit('next');
}

function save() {
    visible.value = false;
    stage.value = 1;
    emit('save');
}

function prev() {
    stage.value--;
    emit('back');
}

function close() {
    visible.value = false;
    emit('close');
}

watch(stage, (stage) => {
    emit('onchange', stage);
});
</script>

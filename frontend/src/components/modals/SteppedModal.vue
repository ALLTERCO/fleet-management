<template>
    <Modal
        :visible="visible"
        :wide="wide"
        :huge="huge"
        :compact="compact"
        @close="close"
    >
        <template #title>
            <span>
                <slot name="title" />
            </span>
            <div class="sm-steps">
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
            <!-- Custom footer for flows needing conditional steps or extra
                 actions; falls back to the standard Back/Next/Save. -->
            <slot
                v-if="$slots.footer"
                name="footer"
                :stage="stage"
                :max-steps="maxSteps"
                :next="next"
                :prev="prev"
                :save="save"
                :close="close"
            />
            <div v-else class="sm-footer">
                <Button v-if="stage > 1" type="blue-hollow" @click="prev">
                    Back
                </Button>
                <div class="sm-footer-spacer" />
                <Button v-if="stage !== maxSteps" type="blue" @click="next">
                    Next
                </Button>
                <Button v-else type="green" :requires-write="requiresWrite" @click="save">
                    Save
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
    requiresWrite?: boolean;
    wide?: boolean;
    huge?: boolean;
    compact?: boolean;
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
    emit('onchange', to);
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

watch(stage, (s) => {
    emit('onchange', s);
});
</script>

<style scoped>
.sm-steps {
    font-size: var(--type-body);
    font-weight: 700;
    margin-top: var(--gap-md);
}
.sm-footer {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
}
.sm-footer-spacer { flex: 1; }
</style>

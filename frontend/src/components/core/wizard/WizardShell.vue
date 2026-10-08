<template>
    <Modal
        :visible="visible"
        :wide="wide"
        :xlarge="xlarge"
        own-scroll
        @close="emit('close')"
    >
        <template #title>{{ title }}</template>

        <!-- The steps are the map of the flow, so they sit at the top where a
             reader looks first, numbered like every other wizard here; the
             footer keeps only the buttons. -->
        <Steps
            class="wzsh__steps"
            :steps="steps.length"
            :current="currentIndex + 1"
            :max-reachable="furthestReachable + 2"
            @click="(n) => goTo(n - 1)"
        >
            <template #stepTitle="{id}">
                {{ steps[id - 1]?.label }}
            </template>
        </Steps>

        <div class="wzsh__body" :data-step="currentStep?.id">
            <slot :step="currentStep" />
        </div>

        <template #footer>
            <ModalFooter>
                <template #meta>
                    <!-- A flow may own something footer-shaped of its own: a
                         preview control, a "saved" flash. -->
                    <slot name="footer-meta" />
                </template>

                <template #secondary>
                    <p v-if="error" class="wzsh__error" role="alert">
                        {{ error }}
                    </p>
                    <Button
                        type="blue-hollow"
                        size="md"
                        :disabled="busy"
                        @click="onBack"
                    >
                        {{ atStart ? 'Cancel' : 'Back' }}
                    </Button>
                </template>

                <template #primary>
                    <Button
                        v-if="!onFinalStep"
                        type="green"
                        size="md"
                        :disabled="!mayAdvance || busy"
                        @click="onNext"
                    >
                        Next
                    </Button>
                    <Button
                        v-else
                        type="green"
                        size="md"
                        :disabled="!everyStepAnswered || busy"
                        :requires-write="requiresWrite"
                        @click="emit('submit')"
                    >
                        {{ submitLabel }}
                    </Button>
                </template>
            </ModalFooter>
        </template>
    </Modal>
</template>

<script setup lang="ts">
// One shell for every task flow in the product: add a device, build an alert,
// wire a channel. It owns the modal, the strip, the footer and the gating so a
// flow only has to say what its steps are and when each one is satisfied.
//
// Back on the first step reads "Cancel" — the escape and the step-backwards
// are the same physical button, so the label has to tell the truth about which
// one it currently is.
import {computed} from 'vue';
import Button from '@/components/core/Button.vue';
import ModalFooter from '@/components/core/ModalFooter.vue';
import Steps from '@/components/core/Steps.vue';
import Modal from '@/components/modals/Modal.vue';
import {
    canAdvance,
    clampStepIndex,
    describeSegments,
    isFinalStep,
    type WizardStepDef
} from '@/helpers/wizardFlow';

const props = defineProps<{
    visible: boolean;
    title: string;
    steps: readonly WizardStepDef[];
    /** Verb on the final button, e.g. "Create alert". */
    submitLabel: string;
    /** A save in flight — freezes navigation so a step cannot change under it. */
    busy?: boolean;
    /** Gate the commit on write permission — the flow knows if it writes. */
    requiresWrite?: boolean;
    error?: string | null;
    wide?: boolean;
    xlarge?: boolean;
}>();

const emit = defineEmits<{
    close: [];
    submit: [];
}>();

const currentIndex = defineModel<number>('currentIndex', {required: true});

const safeIndex = computed(() =>
    clampStepIndex(props.steps, currentIndex.value)
);

const currentStep = computed(() => props.steps[safeIndex.value]);

const segments = computed(() =>
    describeSegments(props.steps, safeIndex.value)
);

// The highest step a reader may jump to: every answered step behind, plus
// the one in view. Steps counts from one.
const furthestReachable = computed(() => {
    let last = safeIndex.value;
    segments.value.forEach((segment, index) => {
        if (segment.reachable && index > last) last = index;
    });
    return last;
});
const mayAdvance = computed(() => canAdvance(props.steps, safeIndex.value));

const onFinalStep = computed(() => isFinalStep(props.steps, safeIndex.value));

const atStart = computed(() => safeIndex.value === 0);

// The final button commits the whole flow, so it answers for the whole flow —
// not just the step in view. A step left blank behind you still blocks it.
const everyStepAnswered = computed(() =>
    props.steps.every((step) => step.complete)
);

function onNext(): void {
    if (!mayAdvance.value) return;
    currentIndex.value = safeIndex.value + 1;
}

function onBack(): void {
    if (atStart.value) {
        emit('close');
        return;
    }
    currentIndex.value = safeIndex.value - 1;
}

function goTo(index: number): void {
    if (props.busy) return;
    if (!segments.value[index]?.reachable) return;
    currentIndex.value = index;
}
</script>

<style scoped>
.wzsh__steps {
    margin-bottom: var(--gap-md);
}

.wzsh__body {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
    min-height: 0;
}

.wzsh__error {
    margin: 0;
    color: var(--color-danger-text);
    font-size: var(--type-caption);
}
</style>

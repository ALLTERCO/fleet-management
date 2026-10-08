<template>
    <Modal :visible="visible" xlarge own-scroll @close="onCloseRequest">
        <template #title>{{ heroTitle }}</template>

        <div class="adw">
            <Steps
                v-if="activeFlow.length > 1"
                :steps="activeFlow.length"
                :current="currentIndex + 1"
                @click="goToStep"
            >
                <template #stepTitle="{id}">
                    {{ activeFlow[id - 1]?.label }}
                </template>
            </Steps>

            <div class="adw__body">
                <section class="adw__form" :data-step="currentStepId">
                    <WizardState v-if="!activeFlow.length" tone="empty">
                        {{ noFlowMessage }}
                    </WizardState>
                    <Transition v-else :name="transitionName">
                        <KeepAlive>
                            <PickPartsStep
                                v-if="currentStepId === 'parts'"
                                key="parts"
                            />
                            <VirtualTemplateStep
                                v-else-if="currentStepId === 'template'"
                                key="template"
                            />
                            <DeviceDetailsStep
                                v-else-if="currentStepId === 'details'"
                                key="details"
                            />
                            <BluetoothGatewayStep
                                v-else-if="currentStepId === 'gateway'"
                                key="gateway"
                                :model-value="bluetoothGatewayId"
                                @update:model-value="onGatewayPicked"
                            />
                            <BluetoothPairStep
                                v-else-if="currentStepId === 'pair'"
                                key="pair"
                                :gateway-id="bluetoothGatewayId"
                                @paired="onPaired"
                            />
                            <BluetoothIdentifyStep
                                v-else-if="
                                    currentStepId === 'identify' &&
                                    draft.kind === 'bluetooth'
                                "
                                key="bluetooth-identify"
                                :gateway-id="bluetoothGatewayId"
                                :reload-key="pairedCount"
                                @created="onCreated"
                            />
                            <RealSourceStep
                                v-else-if="currentStepId === 'source'"
                                key="real-source"
                            />
                        </KeepAlive>
                    </Transition>
                </section>
            </div>
        </div>

        <template #footer>
            <div class="adw__footer">
                <span v-if="saveError" class="adw__footer-error" role="alert">
                    {{ saveError }}
                </span>

                <!-- A kind with no steps has nothing to navigate or abandon. -->
                <Button
                    v-if="!activeFlow.length"
                    type="blue-hollow"
                    size="sm"
                    @click="onCloseRequest"
                >
                    Close
                </Button>

                <template v-else>
                    <Button
                        v-if="currentIndex > 0"
                        type="blue-hollow"
                        size="sm"
                        @click="goBack"
                    >
                        Back
                    </Button>
                    <!-- Cancel only while nothing has been created. On a
                         terminal step the devices already exist, so Done is
                         the honest word. -->
                    <Button
                        v-if="!isTerminalStep"
                        type="blue-hollow"
                        size="sm"
                        @click="onCloseRequest"
                    >
                        Cancel
                    </Button>
                    <Button
                        v-if="currentStepId === 'details'"
                        type="green"
                        size="sm"
                        :disabled="saving || !draft.canPreview"
                        :loading="saving"
                        @click="onSave"
                    >
                        Save device
                    </Button>
                    <Button
                        v-else-if="isTerminalStep"
                        type="blue-hollow"
                        size="sm"
                        @click="onCloseRequest"
                    >
                        Done
                    </Button>
                    <Button
                        v-else
                        type="blue"
                        size="sm"
                        :disabled="!canAdvance"
                        @click="goNext"
                    >
                        Next
                    </Button>
                </template>
            </div>
        </template>
    </Modal>

    <ConfirmationModal ref="discardModal">
        <template #title>
            <h3>{{ discardTitle }}</h3>
        </template>
        {{ discardMessage }}
    </ConfirmationModal>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Steps from '@/components/core/Steps.vue';
import WizardState from '@/components/core/wizard/WizardState.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import Modal from '@/components/modals/Modal.vue';
import {deviceKindLabel} from '@/helpers/deviceKindMeta';
import {actionableError} from '@/helpers/rpcError';
import {useToastStore} from '@/stores/toast';
import {
    useVirtualDeviceDraftStore,
    type WizardKind
} from '@/stores/virtualDeviceDraftStore';
import BluetoothGatewayStep from './BluetoothGatewayStep.vue';
import BluetoothIdentifyStep from './BluetoothIdentifyStep.vue';
import BluetoothPairStep from './BluetoothPairStep.vue';
import DeviceDetailsStep from './DeviceDetailsStep.vue';
import PickPartsStep from './PickPartsStep.vue';
import RealSourceStep from './RealSourceStep.vue';
import VirtualTemplateStep from './VirtualTemplateStep.vue';

interface StepDef {
    id: string;
    label: string;
}

// The kind is chosen up front in the add-device menu, so each flow starts at
// its first real step — there is no in-wizard kind step.
const FLOWS: Record<Exclude<WizardKind, null>, StepDef[]> = {
    physical: [{id: 'source', label: 'Source'}],
    bluetooth: [
        {id: 'gateway', label: 'Gateway'},
        {id: 'pair', label: 'Pair'},
        {id: 'identify', label: 'Identify'}
    ],
    composed: [
        {id: 'template', label: 'Template'},
        {id: 'parts', label: 'Pick parts'},
        {id: 'details', label: 'Details'}
    ],
    // Extracted devices are created from a host group through ExtractGroupModal.
    extracted: [],
    // Connector is disabled in the add-device menu, so the wizard never opens
    // for it — this entry only keeps the kind map exhaustive.
    connector: []
};

// A kind with no steps has no wizard. Say where it lives instead of opening an
// empty panel with a live footer.
const NO_FLOW_MESSAGE: Record<string, string> = {
    extracted: 'Extracted devices are made from a group, on the group page.',
    connector: 'Connectors are not available yet.'
};

const props = withDefaults(
    defineProps<{visible: boolean; kind?: WizardKind}>(),
    {kind: null}
);
const emit = defineEmits<{
    close: [];
    created: [externalId: string];
}>();

const draft = useVirtualDeviceDraftStore();
const toast = useToastStore();
const currentIndex = ref(0);
const transitionName = ref('adw-step-next');
const bluetoothGatewayId = ref<string | null>(null);
// Counts pairs made in this run: it advances the wizard and re-reads the
// identify list, which otherwise stays cached behind KeepAlive.
const pairedCount = ref(0);
const saving = ref(false);
const saveError = ref('');

const activeFlow = computed<StepDef[]>(() =>
    draft.kind ? FLOWS[draft.kind] : []
);
const currentStepId = computed(() => activeFlow.value[currentIndex.value]?.id);
const heroTitle = computed(() =>
    draft.kind ? deviceKindLabel(draft.kind) : 'Add a device to your fleet'
);
const noFlowMessage = computed(() =>
    draft.kind
        ? (NO_FLOW_MESSAGE[draft.kind] ?? 'This device kind has no setup steps.')
        : 'Pick a device kind to start.'
);
const canAdvance = computed(() => {
    if (currentIndex.value >= activeFlow.value.length - 1) return false;
    switch (currentStepId.value) {
        case 'template':
            return draft.templateChosen;
        case 'parts':
            return draft.readyForDetails;
        case 'details':
            return false;
        case 'gateway':
            return bluetoothGatewayId.value !== null;
        case 'pair':
            // The identify step lists every candidate the gateway holds, not
            // just this run's. Gating on pairedCount made a sensor paired in an
            // earlier session unreachable: the wizard dead-ended at Pair.
            return bluetoothGatewayId.value !== null;
        default:
            return true;
    }
});

const isTerminalStep = computed(() => {
    if (currentIndex.value < activeFlow.value.length - 1) return false;
    if (draft.kind === 'physical') return currentStepId.value === 'source';
    if (draft.kind === 'bluetooth') return currentStepId.value === 'identify';
    return false;
});

function onGatewayPicked(shellyID: string): void {
    bluetoothGatewayId.value = shellyID;
}

function onPaired(_mac: string, meta?: {alreadyPaired: boolean}): void {
    // A repeat of a pairing the gateway already had is nothing to lose.
    if (meta?.alreadyPaired) return;
    pairedCount.value += 1;
    // The pairing lives on the gateway now, so leaving has a consequence.
    draft.notePaired();
}

function goNext(): void {
    if (currentIndex.value < activeFlow.value.length - 1) {
        transitionName.value = 'adw-step-next';
        currentIndex.value += 1;
    }
}

function goBack(): void {
    if (currentIndex.value === 0) return;
    transitionName.value = 'adw-step-prev';
    currentIndex.value -= 1;
}

// Backward only. A later step is built from choices the earlier ones make, so
// jumping ahead would land on a step whose inputs do not exist yet.
function goToStep(step: number): void {
    const target = step - 1;
    if (target < 0 || target >= currentIndex.value) return;
    transitionName.value = 'adw-step-prev';
    currentIndex.value = target;
}

interface ConfirmHandle {
    storeAction(
        action: () => void | Promise<void>,
        opts?: {confirmLabel?: string; cancelLabel?: string}
    ): boolean;
}

const discardModal = ref<ConfirmHandle>();

const isBluetooth = computed(() => draft.kind === 'bluetooth');
const discardTitle = computed(() =>
    isBluetooth.value ? 'Leave without adding them?' : 'Discard this device?'
);
const discardMessage = computed(() =>
    isBluetooth.value
        ? 'The sensors you paired stay on the gateway. They just will not be added to your fleet yet.'
        : 'The parts you connected and the details you entered will be lost.'
);

// A composed device can hold ten minutes of work. Esc, the backdrop, the X and
// Cancel all land here, so the guard belongs here rather than on each of them.
function onCloseRequest(): void {
    if (!draft.isDirty) {
        emit('close');
        return;
    }
    discardModal.value?.storeAction(() => emit('close'), {
        confirmLabel: isBluetooth.value ? 'Leave' : 'Discard',
        cancelLabel: isBluetooth.value ? 'Stay' : 'Keep editing'
    });
}

function onCreated(externalId: string, name?: string): void {
    draft.noteAdded();
    // The BLU flow keeps the step open, so the modal closing cannot be the
    // confirmation the way it is for the other kinds. Without this the only
    // sign of a successful promote was a pill where the button had been.
    toast.success(`${name?.trim() || 'Device'} added to your fleet`);
    emit('created', externalId);
    // A gateway may expose several paired children. Keep the identify step
    // open so they can all be promoted in one pass; Finish closes the wizard.
    if (draft.kind !== 'bluetooth') emit('close');
}

async function onSave(): Promise<void> {
    saving.value = true;
    saveError.value = '';
    const name = draft.details.name.trim() || 'Device';
    try {
        const created = await draft.commit();
        // The modal vanishing was the only sign the device existed. The BLU and
        // physical flows both confirm in place; this one now says so too.
        toast.success(`${name} added to your fleet`);
        emit('created', created.externalId);
        emit('close');
    } catch (e) {
        saveError.value = actionableError(
            e,
            'Could not save this device. Check the name is not already taken, then try again.'
        );
    } finally {
        saving.value = false;
    }
}

watch(
    () => props.visible,
    (open) => {
        if (open) {
            // Start each run from a clean draft seeded with the kind the user
            // chose in the add-device menu, then open on its first real step.
            draft.reset();
            if (props.kind) draft.setKind(props.kind);
            currentIndex.value = 0;
            transitionName.value = 'adw-step-next';
            bluetoothGatewayId.value = null;
            pairedCount.value = 0;
            saving.value = false;
            saveError.value = '';
        }
    }
);
</script>

<style scoped>
.adw {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
    height: 100%;
    min-height: 420px;
}

.adw__body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    flex: 1;
    min-height: 0;
}
/* No inner surface. The modal panel is already the frosted glass; the step
   content sits straight on it. This is the one scroller, with the steps and
   the footer outside it so they stay put. */
.adw__form {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 var(--gap-lg) var(--gap-md);
}

.adw__footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--gap-sm);
}
.adw__footer-error {
    margin-right: auto;
    color: var(--color-danger-text);
    font-size: var(--type-caption);
}

.adw-step-next-enter-active,
.adw-step-prev-enter-active {
    transition:
        opacity var(--duration-quick),
        transform var(--duration-quick) var(--ease-apple-spring);
}
.adw-step-next-leave-active,
.adw-step-prev-leave-active {
    transition:
        opacity var(--duration-fast),
        transform var(--duration-fast) ease-in;
}
.adw-step-next-enter-from {
    opacity: 0;
    transform: translateX(12px);
}
.adw-step-next-leave-to {
    opacity: 0;
    transform: translateX(-8px);
}
.adw-step-prev-enter-from {
    opacity: 0;
    transform: translateX(-12px);
}
.adw-step-prev-leave-to {
    opacity: 0;
    transform: translateX(8px);
}

</style>

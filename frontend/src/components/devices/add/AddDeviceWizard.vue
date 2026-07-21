<template>
    <Modal :visible="visible" large @close="onCloseRequest">
        <template #title>{{ heroTitle }}</template>

        <div class="adw">
            <div class="adw__body">
                <section class="adw__form" :data-step="currentStepId">
                    <Transition :name="transitionName">
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
                            />
                            <BluetoothIdentifyStep
                                v-else-if="
                                    currentStepId === 'identify' &&
                                    draft.kind === 'bluetooth'
                                "
                                key="bluetooth-identify"
                                :gateway-id="bluetoothGatewayId"
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
                <Button
                    v-if="currentIndex > 0"
                    type="blue-hollow"
                    size="sm"
                    @click="goBack"
                >
                    Back
                </Button>
                <Button type="blue-hollow" size="sm" @click="onCloseRequest">
                    Cancel
                </Button>
                <Button
                    v-if="canAdvance"
                    type="blue"
                    size="sm"
                    @click="goNext"
                >
                    Next
                </Button>
                <Button
                    v-else-if="currentStepId === 'details'"
                    type="blue"
                    size="sm"
                    :disabled="saving || !draft.canPreview"
                    @click="onSave"
                >
                    Save device
                </Button>
                <Button
                    v-else-if="isTerminalStep"
                    type="blue"
                    size="sm"
                    @click="onCloseRequest"
                >
                    Finish
                </Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Modal from '@/components/modals/Modal.vue';
import {deviceKindLabel} from '@/helpers/deviceKindMeta';
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

const props = withDefaults(
    defineProps<{visible: boolean; kind?: WizardKind}>(),
    {kind: null}
);
const emit = defineEmits<{
    close: [];
    created: [externalId: string];
}>();

const draft = useVirtualDeviceDraftStore();
const currentIndex = ref(0);
const transitionName = ref('adw-step-next');
const bluetoothGatewayId = ref<string | null>(null);
const saving = ref(false);
const saveError = ref('');

const activeFlow = computed<StepDef[]>(() =>
    draft.kind ? FLOWS[draft.kind] : []
);
const currentStepId = computed(() => activeFlow.value[currentIndex.value]?.id);
const heroTitle = computed(() =>
    draft.kind ? deviceKindLabel(draft.kind) : 'Add a device to your fleet'
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

function onCloseRequest(): void {
    emit('close');
}

function onCreated(externalId: string): void {
    emit('created', externalId);
    emit('close');
}

async function onSave(): Promise<void> {
    saving.value = true;
    saveError.value = '';
    try {
        const created = await draft.commit();
        emit('created', created.externalId);
        emit('close');
    } catch (e) {
        saveError.value = e instanceof Error ? e.message : String(e);
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
            saving.value = false;
            saveError.value = '';
        }
    }
);
</script>

<style scoped>
.adw {
    display: grid;
    gap: var(--gap-lg);
    min-height: 420px;
}
.adw__body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
}
.adw__form {
    min-height: 340px;
    padding: var(--gap-md) var(--gap-lg);
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

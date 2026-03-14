<template>
    <SteppedModal
        :stage="stage"
        :visible="visible"
        :max-steps="Object.keys(STAGES).length"
        wide
        @save="onSave"
        @close="onClose"
    >
        <template #title> {{ isEditMode ? 'Edit Action' : 'Create Action' }} </template>

        <template #stepTitle="{ stage }">
            <span v-if="stage == STAGES.SELECT_DEVICES" class="font-semibold">Devices</span>
            <span v-if="stage == STAGES.BUILD" class="font-semibold">Build</span>
            <span v-if="stage == STAGES.PREVIEW" class="font-semibold">Preview</span>
            <span v-if="stage == STAGES.MAIN" class="font-semibold">Main</span>
        </template>

        <template #default="{ stage }">
            <div v-if="stage === STAGES.SELECT_DEVICES" class="flex min-h-[34rem] min-h-0 flex-col">
                <DeviceSelector v-model="selectedDevices" />
            </div>

            <div v-else-if="stage === STAGES.BUILD" class="flex min-h-[34rem] min-h-0 flex-col gap-4">
                <div class="flex flex-col gap-2 xl:flex-row xl:items-center">
                    <span class="has-text-white shrink-0">Preset methods:</span>
                    <Dropdown class="xl:min-w-[16rem]" :options="ALLOWED_COMPONENT_NAMES" :searchable="true" @selected="componentSelected" />
                    <Dropdown v-if="componentMethodNames" :options="componentMethodNames" :searchable="true" @selected="methodSelected" />
                </div>
                <div class="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--color-border-default)] p-3">
                    <VueJsonPretty
                        v-model:data="json"
                        :deep="Infinity"
                        :editable="true"
                        :show-line="false"
                    />
                </div>
            </div>

            <div v-else-if="stage === STAGES.PREVIEW" class="flex min-h-[34rem] min-h-0 flex-col gap-3">
                <span class="font-semibold">You are sending this command:</span>
                <pre class="max-h-[18rem] overflow-auto rounded bg-black p-3">{{ JSON.stringify(json, undefined, 2) }}</pre>
                <span class="font-semibold">To these {{ selectedDevices.length }} devices:</span>
                <ul class="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                    <li v-for="deviceID in selectedDevices" :key="deviceID">
                        <DeviceWidget :device-id="deviceID" vertical />
                    </li>
                </ul>
            </div>

            <div v-else-if="stage == STAGES.MAIN" class="flex min-h-[18rem] flex-col">
                <Input v-model="name" label="Action name" :error="nameError"
                    aria-label="Action name" @blur="validateName" />
            </div>
        </template>
    </SteppedModal>
</template>

<script lang="ts" setup>
import {computed, defineAsyncComponent, ref, watch} from 'vue';

const VueJsonPretty = defineAsyncComponent(() => import('vue-json-pretty'));
import 'vue-json-pretty/lib/styles.css';

import Dropdown from '@/components/core/Dropdown.vue';
import default_rpc from '@/data/default_rpc.json';
import {getRegistry} from '@/tools/websocket';
import type {action_t} from '@/types';
import DeviceSelector from '../DeviceSelector.vue';
import Input from '../core/Input.vue';
import DeviceWidget from '../widgets/DeviceWidget.vue';
import SteppedModal from './SteppedModal.vue';

// Change type of default exported JSON
const defaultRpc: Record<string, any> = {...default_rpc};

const props = defineProps<{
    action?: action_t | null;
    visible: boolean;
    duplicate?: boolean;
}>();
const emit = defineEmits<{close: []}>();

const isEditMode = computed(() => !!props.action && !props.duplicate);

const STAGES = {
    SELECT_DEVICES: 1,
    BUILD: 2,
    PREVIEW: 3,
    MAIN: 4
} as const;

const stage = ref(STAGES.SELECT_DEVICES);

const selectedDevices = ref<string[]>(
    props.action ? props.action.actions?.[0]?.dst : []
);
const name = ref(props.action ? props.action.name : '');
const nameError = ref('');

function validateName() {
    nameError.value =
        !name.value || name.value.trim() === ''
            ? 'Action name is required'
            : '';
}

const component = ref<string>(
    props.action ? Object.keys(props.action.actions[0])[0] : 'Shelly'
);
const method = ref<string>(
    props.action
        ? Object.keys(props.action.actions[0][component.value])[0]
        : 'GetStatus'
);

const json = ref<Record<string, any>>(
    props.action
        ? props.action.actions[0]
        : defaultRpc[component.value]?.[method.value]
);

const ALLOWED_COMPONENT_NAMES = Object.keys(defaultRpc);
const componentMethods = computed<Record<string, any>>(
    () => defaultRpc[component.value as keyof typeof defaultRpc]
);
const componentMethodNames = computed(() =>
    Object.keys(componentMethods.value || {})
);

watch(
    () => props.action,
    (newAction) => {
        if (newAction?.actions.length) {
            selectedDevices.value = newAction.actions[0].dst;
            json.value = newAction.actions[0];
            name.value = newAction.name;
            setComponent(Object.keys(newAction.actions[0])[0] || 'Shelly');
        }
    },
    {immediate: true}
);

function setComponent(comp: string) {
    if (!ALLOWED_COMPONENT_NAMES.includes(comp)) {
        console.warn('Invalid component', comp);
        return;
    }
    component.value = comp;
    method.value = componentMethodNames.value[0];
    json.value = defaultRpc[component.value]?.[method.value] || {};
}

function setMethod(selectedMethod: string) {
    if (!componentMethods.value[selectedMethod]) {
        console.warn('Invalid method', selectedMethod);
        return;
    }
    method.value = selectedMethod;
    json.value = defaultRpc[component.value]?.[method.value] || {};
}

function componentSelected(comp: string) {
    setComponent(comp);
}

function methodSelected(method: string) {
    setMethod(method);
}

function onClose() {
    stage.value = STAGES.SELECT_DEVICES;
    emit('close');
}

async function onSave() {
    validateName();
    if (nameError.value) return;

    const dst =
        Array.isArray(json.value.dst) && json.value.dst.length
            ? json.value.dst
            : selectedDevices.value;

    const rawActions = [
        {
            ...json.value,
            dst
        }
    ];

    const payload: {id?: number; name: string; actions: string} = {
        name: name.value,
        actions: JSON.stringify(rawActions)
    };

    if (isEditMode.value && props.action?.id) {
        payload.id = Number.parseInt(props.action.id, 10);
    }

    const ActionsController = getRegistry('actions');
    await ActionsController.setItem('rpc', payload);
    onClose();
}
</script>

<style>
.vjs-tree {
    color: #e2e8f0 !important;
    background-color: transparent !important;
}
</style>

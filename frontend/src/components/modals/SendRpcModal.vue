<template>
    <Modal :visible="rpcBuilderStore.showModal" @close="onClose()">
        <template #title> Send Remote Procedure Call </template>

        <template #default>
            <div class="space-y-6">
                <Steps :current="stage" :steps="runNow ? 4 : 3" @click="(selected) => (stage = selected)">
                    <template #stepTitle="{ id }">
                        <span v-if="id == STAGES.BUILD" class="font-semibold">Build</span>
                        <span v-if="id == STAGES.PREVIEW" class="font-semibold">Preview</span>
                        <span v-if="id == STAGES.SAVE" class="font-semibold">Save</span>
                        <span v-if="id == STAGES.RESPONSES" class="font-semibold">Responses</span>
                    </template>
                </Steps>
                <div class="flex flex-col gap-4">
                    <div v-if="stage == STAGES.BUILD" class="space-y-3">
                        <div class="flex flex-row items-center">
                            <span class="has-text-white mr-2">Preset methods:</span>
                            <Dropdown
                                class="mr-2"
                                :options="rpcBuilderStore.ALLOWED_COMPONENT_NAMES"
                                @selected="componentSelected"
                            />
                            <Dropdown
                                v-if="rpcBuilderStore.componentMethodNames"
                                :options="rpcBuilderStore.componentMethodNames"
                                @selected="methodSelected"
                            />
                        </div>
                        <Vue3JsonEditor
                            v-model="json"
                            :show-btns="false"
                            :expanded-on-start="true"
                            @json-change="onJsonChange"
                        />
                    </div>
                    <div v-if="stage == STAGES.PREVIEW" class="flex flex-col gap-3">
                        <span class="font-semibold">You are sending this command:</span>
                        <pre class="rpc-preview-code p-3 rounded">{{ JSON.stringify(json, undefined, 2) }}</pre>
                        <span class="font-semibold">To this {{ deviceStore.selectedDevices.length }} devices:</span>
                        <ul class="space-y-2">
                            <template v-if="deviceStore.selectedDevices.length > 0">
                                <li v-for="dev in deviceStore.selectedDevices" :key="dev.shellyID">
                                    <DeviceWidget v-memo="[dev.shellyID]" :device-id="dev.shellyID" vertical />
                                </li>
                            </template>
                            <template v-else>
                                <li v-for="(dev, shellyID) in deviceStore.devices" :key="shellyID">
                                    <DeviceWidget v-memo="[shellyID]" :device-id="String(shellyID)" vertical />
                                </li>
                            </template>
                        </ul>
                    </div>
                    <div v-if="stage == STAGES.SAVE" class="flex flex-col gap-1">
                        <Checkbox v-model="runNow"> Run now </Checkbox>
                        <Checkbox v-model="save.enable"> Save this action </Checkbox>
                        <div v-if="save.enable">
                            <Input v-model="save.name" label="Action name" :error="saveNameError"
                                aria-label="Action name" @blur="validateSaveName" />
                        </div>
                    </div>
                    <div v-if="stage == STAGES.RESPONSES" class="flex flex-col gap-1">
                        <Collapse
                            v-for="(resp, id) in deviceStore.rpcResponses"
                            :key="id"
                            :title="id"
                            class="rpc-collapse-border"
                        >
                            <JSONViewer :data="resp" />
                        </Collapse>
                    </div>
                </div>
            </div>
        </template>

        <template #footer>
            <div class="flex flex-row-reverse gap-4">
                <Button type="blue" :requires-write="true" @click="nextOrFinish">{{ isLastStage() ? 'Finish' : 'Next' }}</Button>
                <Button v-if="stage != 1" type="blue" @click="backClicked">Back</Button>
            </div>
            <p v-if="isReadOnly" class="rpc-readonly-warning text-sm mt-2">
                <i class="fas fa-exclamation-triangle mr-1"></i>
                You have read-only access. Command execution is disabled.
            </p>
        </template>
    </Modal>
</template>

<script lang="ts" setup>
import {defineAsyncComponent, reactive, ref, toValue, watch} from 'vue';
import Modal from '@/components/modals/Modal.vue';
import {usePermissions} from '@/composables/usePermissions';
import {useDevicesStore} from '@/stores/devices';
import {useRpcBuilderStore} from '@/stores/rpc-builder';
import {useToastStore} from '@/stores/toast';

const {isReadOnly} = usePermissions();
const Vue3JsonEditor = defineAsyncComponent(() =>
    import('vue3-json-editor/dist/vue3-json-editor.esm').then(
        (m) => m.Vue3JsonEditor
    )
);

import Button from '@/components/core/Button.vue';
import Collapse from '@/components/core/Collapse.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import Steps from '@/components/core/Steps.vue';
import {getRegistry} from '@/tools/websocket';
import Checkbox from '../core/Checkbox.vue';
import Input from '../core/Input.vue';
import JSONViewer from '../JSONViewer.vue';
import DeviceWidget from '../widgets/DeviceWidget.vue';

const emit = defineEmits<{
    close: [void];
}>();

const STAGES = {
    BUILD: 1,
    PREVIEW: 2,
    SAVE: 3,
    RESPONSES: 4
} as const;

const toastStore = useToastStore();
const deviceStore = useDevicesStore();
const rpcBuilderStore = useRpcBuilderStore();

const save = reactive({
    enable: false,
    name: ''
});
const runNow = ref(true);
const saveNameError = ref('');

function validateSaveName() {
    saveNameError.value = save.enable && !save.name.trim() ? 'Action name is required' : '';
}

const json = ref<Record<string, any>>({});

function onJsonChange(val: any) {
    json.value = val;
}

function componentSelected(comp: string) {
    rpcBuilderStore.setComponent(comp);
    json.value = rpcBuilderStore.template;
}

function methodSelected(method: string) {
    rpcBuilderStore.setMethod(method);
    json.value = rpcBuilderStore.template;
}

function onClose() {
    rpcBuilderStore.showModal = false;
    save.enable = false;
    save.name = '';
    saveNameError.value = '';
    json.value = rpcBuilderStore.template;
    runNow.value = true;
    stage.value = STAGES.BUILD;
    emit('close');
}

// Panels

const stage = ref(1);

async function finish() {
    if (save.enable) {
        validateSaveName();
        if (saveNameError.value) {
            stage.value = STAGES.SAVE;
            return;
        }
        // Create the actions array for this action
        const actionsArray = [
            {
                ...toValue(json),
                dst: deviceStore.selectedDevices.map((dev) => dev.shellyID)
            }
        ];

        const ActionsController = getRegistry('actions');
        // This is the format the backend expects:
        await ActionsController.setItem('rpc', {
            name: save.name,
            actions: JSON.stringify(actionsArray)
        });
    }
    stage.value = STAGES.BUILD;
    rpcBuilderStore.showModal = false;
    onClose();
}

function isLastStage() {
    return (
        stage.value == STAGES.RESPONSES ||
        (stage.value === STAGES.SAVE && !runNow.value)
    );
}

function nextOrFinish() {
    if (isLastStage()) {
        finish();
        return;
    }
    if (stage.value == STAGES.SAVE) {
        const method = json.value.method;
        const params = json.value.params;
        if (method) {
            deviceStore.sendTemplateRpc(method, params);
        } else {
            toastStore.error('Bad RPC command. Method not found');
            return;
        }
    }
    stage.value++;
}

function backClicked() {
    if (stage.value == STAGES.BUILD) {
        rpcBuilderStore.showModal = false;
        return;
    }
    stage.value--;
}

watch(
    () => rpcBuilderStore.template,
    () => {
        onJsonChange(rpcBuilderStore.template);
    },
    {immediate: true}
);
</script>

<style>
.jsoneditor-field {
    color: white !important;
}

.jsoneditor-field:hover,
.jsoneditor-field:focus {
    background-color: rgb(30 41 59) !important;
}
</style>

<style scoped>
.rpc-collapse-border { border: 1px solid var(--color-border-strong); }
.rpc-readonly-warning { color: var(--color-warning-text); }
.rpc-preview-code { background-color: var(--color-surface-0); }
</style>

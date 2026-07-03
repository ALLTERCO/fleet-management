<template>
    <PageTemplate
        title="Plugins"
        :tabs="tabs"
        :loading="loading && plugins.length === 0"
        :empty="plugins.length === 0 && !loading"
        empty-title="No plugins found"
        empty-sub="Plugins extend the features of Fleet Manager."
        :items="plugins"
        :page-size="50"
        pagination-mode="infinite"
        url-key="plugins"
        :item-key="pluginItemKey"
    >
        <template #actions>
            <input
                ref="fileInput"
                type="file"
                class="hidden"
                accept=".zip"
                aria-label="Upload plugin"
                @change="handleFileChange"
            />
            <Button v-if="canWrite" size="sm" type="blue" narrow title="Upload plugin" aria-label="Upload plugin" @click="triggerFileInput">
                <i class="fas fa-upload" aria-hidden="true" />
            </Button>
            <Button size="sm" type="blue-hollow" narrow @click="refresh">
                Refresh
            </Button>
            <Button
                v-if="canWrite && !editMode && plugins.length > 0"
                type="blue-hollow"
                size="sm"
                narrow
                title="Edit mode"
                aria-label="Edit mode"
                @click="toggleEditMode"
            >
                <i class="fas fa-pen" aria-hidden="true" />
            </Button>
            <Button
                v-else-if="canWrite && editMode"
                type="blue-hollow"
                size="sm"
                narrow
                @click="toggleEditMode"
            >
                Exit edit mode
            </Button>
        </template>

        <template #item="{item}">
            <PluginWidget
                :plugin="item"
                :edit-mode="editMode"
                @toggle="refresh"
                @delete="onDeletePlugin"
            />
        </template>

        <template #modals>
            <Modal :visible="uploadModal.visible" @close="uploadModal.visible = false">
                <template #title>Upload plugin</template>
                <template v-if="selectedFile" #default>
                    <span>You are about to upload </span>
                    <span class="font-semibold italic">{{ selectedFile.name }}</span>
                    <span class="text-sm text-[var(--color-text-disabled)]">
                        ({{ (selectedFile.size / 1_000_000).toFixed(2) }}MB)
                    </span>
                </template>
                <template #footer>
                    <div class="flex justify-end">
                        <Button v-if="canWrite" type="blue" @click="uploadClicked">Upload</Button>
                    </div>
                </template>
            </Modal>
        </template>
    </PageTemplate>
</template>

<script setup lang="ts">
import {
    type ComputedRef,
    computed,
    inject,
    onBeforeUnmount,
    reactive,
    ref
} from 'vue';
import Button from '@/components/core/Button.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import Modal from '@/components/modals/Modal.vue';
import PluginWidget from '@/components/widgets/PluginWidget.vue';
import useWsRpc from '@/composables/useWsRpc';
import {useRpcPermissions} from '@/helpers/rpcPermissions';
import {sendRPC} from '@/tools/websocket';
import type {RouteTab} from '@/types/page-template';

const rpc = useRpcPermissions();
// Plugin install/remove deploys code into the FM process fleet-wide;
// gated to provider support on the backend so the UI must match.
const canWrite = computed(
    () => rpc.canCall('Plugin.Upload') && rpc.canCall('Plugin.Remove')
);

const tabs = inject<ComputedRef<RouteTab[]>>(
    'settingsTabs',
    computed(() => [])
);

interface PluginInfo {
    name: string;
    version: string;
    description: string;
}
interface FullPluginData {
    location: string;
    info: PluginInfo;
    config: {enable: boolean};
    actionButton: {enabled: boolean};
}
interface WidgetPluginData {
    location: string;
    info: PluginInfo;
    config: {enable: boolean};
}

const editMode = ref(false);
function toggleEditMode() {
    editMode.value = !editMode.value;
}

const {
    data: pluginsRaw,
    loading,
    refresh
} = useWsRpc<{items: (FullPluginData & {name: string})[]}>('Plugin.List');
const plugins = computed(() => pluginsRaw.value?.items ?? []);

function pluginItemKey(item: FullPluginData & {name: string}): string {
    return item.info.name;
}

const fileInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File>();
const fileBase64 = ref<string>('');
const uploadModal = reactive({visible: false});

const triggerFileInput = () => fileInput.value?.click();
function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    selectedFile.value = file;
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
        fileBase64.value = (reader.result as string).replace(
            /^data:.*;base64,/,
            ''
        );
        uploadModal.visible = true;
    };
    reader.onerror = () => alert('Error reading file');
}

let postUploadRefreshTimer: ReturnType<typeof setTimeout> | undefined;
async function uploadClicked() {
    if (!canWrite.value) return;
    await sendRPC('FLEET_MANAGER', 'Plugin.Upload', {data: fileBase64.value});
    if (postUploadRefreshTimer !== undefined) {
        clearTimeout(postUploadRefreshTimer);
    }
    postUploadRefreshTimer = setTimeout(() => {
        postUploadRefreshTimer = undefined;
        refresh();
    }, 1000);
    fileBase64.value = '';
    selectedFile.value = undefined;
    uploadModal.visible = false;
}

onBeforeUnmount(() => {
    if (postUploadRefreshTimer !== undefined) {
        clearTimeout(postUploadRefreshTimer);
    }
});

async function onDeletePlugin(plugin: WidgetPluginData) {
    if (!canWrite.value) return;
    if (!confirm(`Delete plugin '${plugin.info.name}'?`)) return;
    await sendRPC('FLEET_MANAGER', 'Plugin.Remove', {name: plugin.info.name});
    refresh();
}
</script>

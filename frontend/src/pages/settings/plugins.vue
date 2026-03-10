<template>
  <InfiniteGridScrollPage
    :page="page"
    :total-pages="totalPages"
    :items="items"
    :loading="loading"
    @load-items="loadItems"
  >
    <template #header>
      <BasicBlock blurred bordered class="mb-2">
        <div class="flex justify-between items-center">
          <h2 class="heading-card">Plugins</h2>
          <div>
            <input
              ref="fileInput"
              type="file"
              class="hidden"
              accept=".zip"
              aria-label="Upload plugin"
              @change="handleFileChange"
            />
            <Button size="sm" type="blue" class="mr-2" narrow @click="triggerFileInput">
              <i class="fas fa-upload" />
            </Button>
            <Button size="sm" type="blue" class="mr-2" narrow @click="refresh">
              <i class="fas fa-refresh" />
            </Button>
            <Button
              v-if="!editMode"
              type="blue"
              size="sm"
              narrow
              @click="toggleEditMode"
            >
              <i class="fas fa-pencil" />
            </Button>
            <Button
              v-else
              type="red"
              size="sm"
              narrow
              @click="toggleEditMode"
            >
              Exit edit mode
            </Button>
          </div>
        </div>
      </BasicBlock>

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
            <Button @click="uploadClicked">Upload</Button>
          </div>
        </template>
      </Modal>
    </template>

    <template #empty>
      <EmptyBlock>
        <p class="text-xl font-semibold pb-2">No plugins found</p>
        <p class="text-sm pb-2">Plugins extend the features of Fleet Manager.</p>
      </EmptyBlock>
    </template>

    <template #default="{ item: plugin, small }">
      <PluginWidget
        :key="plugin.info.name"
        :plugin="plugin"
        :edit-mode="editMode"
        :vertical="small"
        @toggle="refresh"
        @delete="onDeletePlugin"
      />
    </template>
  </InfiniteGridScrollPage>
</template>

<script setup lang="ts">
import {computed, reactive, ref} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import Button from '@/components/core/Button.vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import Modal from '@/components/modals/Modal.vue';
import InfiniteGridScrollPage from '@/components/pages/InfiniteGridScrollPage.vue';
import PluginWidget from '@/components/widgets/PluginWidget.vue';
import useInfiniteScroll from '@/composables/useInfiniteScroll';
import useFleetManagerRpc from '@/composables/useWsRpc';
import {sendRPC} from '@/tools/websocket';

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
} = useFleetManagerRpc<Record<string, FullPluginData>>('FleetManager.ListPlugins');
const plugins = computed(() => Object.values(pluginsRaw.value || {}));
const {items, page, totalPages, loadItems} = useInfiniteScroll(plugins);

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

async function uploadClicked() {
    await sendRPC('FLEET_MANAGER', 'FleetManager.UploadPlugin', {
        data: fileBase64.value
    });
    setTimeout(refresh, 1000);
    fileBase64.value = '';
    selectedFile.value = undefined;
    uploadModal.visible = false;
}

async function onDeletePlugin(plugin: WidgetPluginData) {
    if (!confirm(`Delete plugin '${plugin.info.name}'?`)) return;
    await sendRPC('FLEET_MANAGER', 'FleetManager.RemovePlugin', {
        name: plugin.info.name
    });
    refresh();
}
</script>

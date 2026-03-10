<template>
  <div class="space-y-4 p-4">
    <h2 class="sr-only">Action Variables</h2>
    <BasicBlock darker title="Variables">
      <template #buttons>
        <div class="flex justify-end">
          <Button type="blue" narrow @click="openCreateModal">+ Add Variable</Button>
        </div>
      </template>
      <div v-if="loading" class="p-4 space-y-2">
        <Skeleton v-for="n in 4" :key="n" variant="text" />
      </div>
      <div v-else-if="error" class="p-4 text-[var(--color-danger-text)]">{{ error }}</div>
      <ul v-else class="mt-4 space-y-2">
        <li
          v-for="key in keys"
          :key="key"
          class="flex justify-between items-center bg-[var(--color-surface-2)] p-3 rounded-xl hover:cursor-pointer shadow-md"
          :class="{ 'border-2 border-[var(--color-primary)]': key === selectedKey }"
          @click="selectKey(key)"
        >
          <span>{{ key }}</span>
          <Button type="red" narrow @click.stop="deleteVariable(key)">Delete</Button>
        </li>
      </ul>
    </BasicBlock>

    <BasicBlock darker :title="selectedKey ? 'Edit Variable' : 'Select a Variable'">
      <div v-if="!selectedKey" class="p-4 text-[var(--color-text-tertiary)]">Select a variable to edit</div>
      <div v-else class="space-y-3 p-4">
        <Input v-model="editName"  label="Name" />
        <Input v-model="editValue" label="Value" />
        <div class="flex space-x-2">
          <Button type="green" @click="saveEdit"   :disabled="loading">Save Changes</Button>
          <Button type="red"   @click="cancelEdit" :disabled="loading">Cancel</Button>
        </div>
      </div>
    </BasicBlock>

    <Modal :visible="createModalVisible" @close="createModalVisible = false">
      <template #title>Add Variable</template>
      <template #default>
        <Input v-model="createName"  label="Name"  />
        <Input v-model="createValue" label="Value" />
      </template>
      <template #footer>
        <Button type="blue"  @click="createVariable"   :disabled="loading">Create</Button>
        <Button type="red"   @click="createModalVisible = false" :disabled="loading">Cancel</Button>
      </template>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import Button from '@/components/core/Button.vue';
import Input from '@/components/core/Input.vue';
import Skeleton from '@/components/core/Skeleton.vue';
import Modal from '@/components/modals/Modal.vue';
import {useToastStore} from '@/stores/toast';
import {getRegistry} from '@/tools/websocket';

const registry = getRegistry('action-variables');
const toast = useToastStore();

const variables = ref<Record<string, string>>({});
const loading = ref(false);
const error = ref<string | null>(null);

const selectedKey = ref<string | null>(null);
const editName = ref('');
const editValue = ref('');

const createModalVisible = ref(false);
const createName = ref('');
const createValue = ref('');

const keys = computed(() => Object.keys(variables.value));

async function fetchVariables() {
    loading.value = true;
    error.value = null;
    try {
        const data = await registry.getAll<Record<string, string>>();
        variables.value = data ?? {};
    } catch (e: any) {
        error.value = e.message || String(e);
    } finally {
        loading.value = false;
    }
}

function selectKey(key: string) {
    selectedKey.value = key;
    editName.value = key;
    editValue.value = variables.value[key];
}

function cancelEdit() {
    selectedKey.value = null;
    editName.value = '';
    editValue.value = '';
}

async function saveEdit() {
    if (!selectedKey.value) return;
    const oldKey = selectedKey.value;
    const newKey = editName.value;
    const newVal = editValue.value;
    loading.value = true;
    try {
        if (newKey !== oldKey) {
            await registry.removeItem(oldKey);
        }
        await registry.setItem(newKey, newVal);
        await fetchVariables();
        toast.success('Variable saved');
        cancelEdit();
    } catch {
        toast.error('Save failed');
    } finally {
        loading.value = false;
    }
}

async function deleteVariable(key: string) {
    loading.value = true;
    try {
        await registry.removeItem(key);
        toast.success('Deleted');
        if (selectedKey.value === key) cancelEdit();
        await fetchVariables();
    } catch {
        toast.error('Delete failed');
    } finally {
        loading.value = false;
    }
}

function openCreateModal() {
    createModalVisible.value = true;
    createName.value = '';
    createValue.value = '';
}

async function createVariable() {
    if (!createName.value) return;
    loading.value = true;
    try {
        await registry.setItem(createName.value, createValue.value);
        await fetchVariables();
        toast.success('Created');
        createModalVisible.value = false;
    } catch {
        toast.error('Create failed');
    } finally {
        loading.value = false;
    }
}

onMounted(fetchVariables);
</script>

<template>
  <Widget>
    <template #upper-corner>Plugin</template>
    <template #name>
      {{ plugin.info.name }} ({{ plugin.info.version }})
    </template>
    <template #description>
      <small class="text-[var(--color-text-tertiary)]">{{ plugin.info.description }}</small>
    </template>
    <template #action>
      <Button
        v-if="!editMode"
        :type="plugin.config.enable ? 'red' : 'blue'"
        :disabled="!actionButtonEnabled"
        @click="toggle"
      >
        {{ plugin.config.enable ? 'Disable' : 'Enable' }}
      </Button>
      <Button
        v-else
        type="red"
        :disabled="!actionButtonEnabled"
        @click="remove"
      >
        Delete
      </Button>
    </template>
  </Widget>
</template>

<script setup lang="ts">
import {ref, toRefs} from 'vue';
import Button from '@/components/core/Button.vue';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';
import Widget from './WidgetsTemplates/VanilaWidget.vue';

interface PluginInfo {
    name: string;
    version: string;
    description: string;
}
interface WidgetPluginData {
    location: string;
    info: PluginInfo;
    config: {enable: boolean};
}

const props = defineProps<{
    plugin: WidgetPluginData;
    editMode: boolean;
}>();
const {plugin, editMode} = toRefs(props);

const emit = defineEmits<{
    (e: 'toggle', plugin: WidgetPluginData): void;
    (e: 'delete', plugin: WidgetPluginData): void;
}>();

const toast = useToastStore();
const actionButtonEnabled = ref(true);

async function toggle() {
    actionButtonEnabled.value = false;
    const name = plugin.value.info.name;
    try {
        if (plugin.value.config.enable) {
            await ws.enablePlugin(name, false);
            toast.success(`Disabled '${name}'`);
        } else {
            await ws.enablePlugin(name, true);
            toast.success(`Enabled '${name}'`);
        }
        emit('toggle', plugin.value);
    } catch (err: any) {
        toast.error(`Failed to update '${name}'`);
        if (err.message) toast.error(err.message);
    } finally {
        actionButtonEnabled.value = true;
    }
}

function remove() {
    emit('delete', plugin.value);
}
</script>

<template>
  <Modal :visible="visible" @close="close">
    <template #title>
      <span class="font-semibold text-lg">Select EM Devices</span>
    </template>

    <template #default>
      <div class="space-y-4">
        <BasicBlock title="Available EM Devices" bordered>
          <MultipleSelector v-model="selected" :options="emDevices" />
        </BasicBlock>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-4">
        <Button type="blue" @click="save">Save</Button>
        <Button type="red" @click="close">Cancel</Button>
      </div>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import Button from '@/components/core/Button.vue';
import MultipleSelector from '@/components/MultipleSelector.vue';
import Modal from '@/components/modals/Modal.vue';
import {getDeviceName, getLogo} from '@/helpers/device';
import {useDevicesStore} from '@/stores/devices';

interface EmDevice {
    shellyID: string;
    name: string;
    pictureUrl: string;
}

const emit = defineEmits<{
    (e: 'update:selected', value: EmDevice[]): void;
    (e: 'close'): void;
}>();

const props = defineProps<{
    visible: boolean;
    modelValue?: EmDevice[];
    defaultDevice: EmDevice;
}>();

const devicesStore = useDevicesStore();

const selected = ref<EmDevice[]>(props.modelValue ?? []);

const emDevices = computed<EmDevice[]>(() => {
    return Object.values(devicesStore.devices)
        .filter((device) => device.shellyID?.toLowerCase().includes('em'))
        .map((device) => ({
            shellyID: device.shellyID,
            name: getDeviceName(device.info),
            pictureUrl: getLogo(device)
        }));
});

onMounted(() => {
    const defaultOption = emDevices.value.find(
        (dev) => dev.shellyID === props.defaultDevice.shellyID
    );
    if (defaultOption) {
        selected.value = [defaultOption];
    }
});

watch(selected, (newVal: EmDevice[]) => {
    const hasDefault = newVal.some(
        (dev: EmDevice) => dev.shellyID === props.defaultDevice.shellyID
    );
    if (!hasDefault) {
        const defaultOption = emDevices.value.find(
            (dev) => dev.shellyID === props.defaultDevice.shellyID
        );
        if (defaultOption) {
            selected.value.push(defaultOption);
        }
    }
});

function save() {
    emit('update:selected', selected.value);
    close();
}

function close() {
    emit('close');
}
</script>

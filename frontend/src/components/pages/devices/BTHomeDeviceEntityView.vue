<template>
  <BTHomeDevicePanel
    :shelly-id="props.shellyID"
    :status="props.status"
    :settings="props.settings"
    :entity-properties="props.entityProperties"
  />
</template>

<script setup lang="ts">
import BTHomeDevicePanel from './BTHomeDevicePanel.vue';

const props = defineProps<{
    status?: Record<string, any>;
    settings?: Record<string, any>;
    canExecute?: boolean;
    shellyID: string;
    entityProperties?: Record<string, any>;
}>();
</script>

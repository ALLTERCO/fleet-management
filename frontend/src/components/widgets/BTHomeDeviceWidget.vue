<template>
  <Widget
    :selected="selected"
    :vertical="vertical"
    class="relative"
    :class="[device.state === 'open' ? '!bg-[var(--color-danger-subtle)]' : '!bg-[var(--color-success-subtle)]', 'backdrop-blur']"
  >
    <template #image>
      <img
        v-lazyload
        class="rounded-full mx-auto mb-2"
        :data-url="getLogo(device)"
        @error="handleImgError"
        alt="Sensor"
      />
    </template>

    <template #upper-corner>
      <span class="text-xs font-semibold flex items-center gap-1">
        <i class="fas fa-door-open" />
        {{ displayLabel }}
      </span>
    </template>

    <template #upper-right-corner>
      <span
        class="widget-badge absolute top-0 right-0 text-xs text-white rounded-bl-lg py-[2px] px-[6px] flex items-center z-10"
      >
        <i class="fas fa-battery-half mr-1" />
        {{ device.battery != null ? device.battery + '%' : '–' }}
      </span>
    </template>

    <template #name>
      <span class="text-sm font-bold line-clamp-2">{{ device.name }}</span>
    </template>

    <template #description>
      <span
        v-if="device.kind === 'door_window'"
        class="text-xs font-semibold"
        :class="device.state === 'open' ? 'text-[var(--color-danger-text)]' : 'text-[var(--color-success-text)]'"
      >
        {{ device.state === 'open' ? 'Open' : 'Closed' }}
      </span>

      <span
        v-else-if="device.kind === 'motion_sensor'"
        class="text-xs font-semibold"
        :class="device.state === 'open' ? 'text-[var(--color-danger-text)]' : 'text-[var(--color-success-text)]'"
      >
        {{ device.state === 'open'
           ? 'Movement detected'
           : 'No movement detected' }}
      </span>

      <span v-else class="text-xs text-[var(--color-text-tertiary)] italic">
        {{ device.kind === 'button'
           ? 'Button'
           : 'Remote Controller' }}
      </span>
    </template>
  </Widget>
</template>

<script setup lang="ts">
import Widget from '@/components/widgets/WidgetsTemplates/VanilaWidget.vue';
import {type SensorDevice, useSensorsStore} from '@/stores/sensors';

const props = defineProps<{
    device: SensorDevice;
    vertical?: boolean;
    selected?: boolean;
}>();

const {getLogo} = useSensorsStore();

function handleImgError(e: any) {
    e.target.src = '/shelly_logo_black.jpg';
}

const displayLabel = {
    door_window: 'Door / Window',
    button: 'Button',
    remote_controller: 'Remote Controller',
    motion_sensor: 'Motion Sensor'
}[props.device.kind];
</script>

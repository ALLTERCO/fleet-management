<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center filter-overlay" role="dialog" aria-modal="true">
    <div class="filter-modal-bg rounded-lg p-6 w-96">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-xl font-semibold">Filter Options</h3>
        <button aria-label="Close filter" @click="$emit('close')" class="filter-close-btn">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>
      <div class="space-y-4">
        <div v-for="(filter, index) in localFilters" :key="filter.id">
          <label class="block text-sm font-medium">{{ filter.label }}</label>
          <div v-if="filter.type === 'input'">
            <Input
              v-model="localFilters[index].value"
              :placeholder="filter.placeholder || ''"
              class="mt-1 block w-full rounded-md filter-input"
            />
          </div>
          <div v-else-if="filter.type === 'dropdown'">
            <Dropdown
              :options="filter.options"
              :icons="filter.icons || []"
              :to-default="false"
              @selected="(option) => localFilters[index].value = option"
            />
          </div>
        </div>
      </div>
      <div class="mt-6 flex justify-end gap-2">
        <Button type="red" @click="resetLocalFilters">Reset</Button>
        <Button type="blue" @click="applyFilters">Apply</Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {reactive, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import Input from '@/components/core/Input.vue';

const props = defineProps({
    filters: {
        type: Array,
        required: true
    }
});

const emit = defineEmits(['applyFilters', 'close']);

const localFilters = reactive(props.filters.map((f: any) => ({...f})));

watch(
    () => props.filters,
    (newFilters) => {
        newFilters.forEach((f: any, i: number) => {
            localFilters[i] = {...f};
        });
    },
    {deep: true}
);

function applyFilters() {
    emit('applyFilters', localFilters);
    emit('close');
}

function resetLocalFilters() {
    localFilters.forEach((filter) => {
        filter.value =
            filter.defaultValue ||
            (filter.type === 'input' ? '' : filter.options[0] || '');
    });
}
</script>

<style scoped>
.filter-overlay { background-color: var(--color-overlay); }
.filter-modal-bg { background-color: var(--color-surface-1); }
.filter-close-btn { color: var(--color-text-tertiary); }
.filter-close-btn:hover { color: var(--color-text-primary); }
.filter-input {
    background-color: var(--color-surface-2);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border-strong);
}
</style>

<template>
    <Modal :visible="true" compact @close="$emit('close')">
        <template #title>Filter Options</template>
        <template #default>
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
        </template>
        <template #footer>
            <div class="flex justify-end gap-2">
                <Button type="blue-hollow" @click="resetLocalFilters">Reset</Button>
                <Button type="blue" @click="applyFilters">Apply</Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {reactive, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import Input from '@/components/core/Input.vue';
import Modal from '@/components/modals/Modal.vue';

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
.filter-input {
    background-color: var(--color-surface-2);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border-strong);
}
</style>

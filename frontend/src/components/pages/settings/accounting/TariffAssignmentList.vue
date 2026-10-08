<template>
    <div v-if="isEmpty" class="ua-state" role="status">
        <div>
            <strong>No {{ filter.direction }} {{ filter.commodity }} assignments.</strong>
            <span>
                Reports remain unpriced where no matching inherited assignment resolves.
            </span>
        </div>
    </div>
    <DataList
        v-else-if="!failed"
        :rows="rows"
        :columns="ASSIGNMENT_COLUMNS"
        :row-key="assignmentKey"
        :loading="loading"
    >
        <template #cell-tariff="{row}">
            <span class="ua-primary" dir="auto">{{ tariffName(tariffs, row.tariffId) }}</span>
        </template>
        <template #cell-direction="{row}">
            <span class="ua-badge" :class="row.direction === 'export' ? 'ua-badge--credit' : ''">
                {{ titleCase(row.direction) }}
            </span>
        </template>
        <template #cell-scope="{row}">
            {{ assignmentScope(row) }}
        </template>
        <template #cell-commodity="{row}">
            {{ titleCase(row.commodity) }} · {{ row.billedUnit }}
        </template>
        <template #cell-actions="{row}">
            <div v-if="canWrite && canRemove(row)" class="ua-row-actions">
                <Button type="red" size="xs" @click="emit('remove', row)">
                    Remove
                </Button>
            </div>
        </template>
    </DataList>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import Button from '@/components/core/Button.vue';
import DataList from '@/components/core/DataList.vue';
import {
    ASSIGNMENT_COLUMNS,
    type Assignment,
    assignmentKey,
    assignmentScope,
    type Commodity,
    canRemove,
    type Direction,
    type Tariff,
    tariffName,
    titleCase
} from './tariffAssignmentView';

const props = defineProps<{
    rows: Assignment[];
    tariffs: Tariff[];
    /** The direction and commodity these rows were filtered by. */
    filter: {direction: Direction; commodity: Commodity};
    loading: boolean;
    failed: boolean;
    canWrite: boolean;
}>();

const emit = defineEmits<{remove: [row: Assignment]}>();

const isEmpty = computed(
    () => !props.loading && !props.failed && props.rows.length === 0
);
</script>

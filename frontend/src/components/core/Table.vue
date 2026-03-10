<template>
    <div class="relative overflow-x-auto rounded">
        <table class="core-table w-full text-sm text-left">
            <thead v-if="header" class="core-table__head text-xs uppercase">
                <tr>
                    <th v-for="text in header" :key="text" scope="col" class="px-6 py-3">
                        {{ text }}
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(row, i) in data" :key="i" class="core-table__row border-b last:border-b-0">
                    <th v-for="(entry, index) in row" :key="entry" scope="row" class="px-6 py-4">
                        <slot :data="row" :entry="entry" :index="index" />
                    </th>
                </tr>
            </tbody>
        </table>
    </div>
</template>

<script setup lang="ts">
type props_t = {
    header?: string[];
    data: string[][];
};

defineProps<props_t>();
</script>

<style scoped>
.core-table {
    color: var(--color-text-tertiary);
}
.core-table__head {
    background-color: var(--color-surface-2);
    color: var(--color-text-tertiary);
}
.core-table__row {
    background-color: var(--color-surface-1);
    border-color: var(--color-border-default);
}
</style>

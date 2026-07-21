<template>
    <div class="prl">
        <div class="prl__list">
            <div v-for="r in rows" :key="r.deviceId" class="prl__row">
                <span class="prl__row-id">{{ r.deviceId }}</span>
                <span class="prl__row-pw">{{ r.password }}</span>
            </div>
        </div>
        <Button type="blue-hollow" size="sm" @click="downloadCsv">
            <i class="fas fa-download" /> Download CSV
        </Button>
    </div>
</template>

<script setup lang="ts">
import Button from '@/components/core/Button.vue';

// One-time per-device password list with CSV export.
const props = defineProps<{
    rows: Array<{deviceId: string; password: string}>;
}>();

function csvCell(v: string): string {
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function downloadCsv(): void {
    const rows = [
        ['device', 'password'],
        ...props.rows.map((r) => [r.deviceId, r.password])
    ];
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv'}));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'device-passwords.csv';
    a.click();
    URL.revokeObjectURL(url);
}
</script>

<style scoped>
.prl {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: flex-start;
}
.prl__list {
    align-self: stretch;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-height: 240px;
    overflow-y: auto;
    padding: var(--space-2);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
}
.prl__row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
}
.prl__row-id {
    color: var(--color-text-tertiary);
}
.prl__row-pw {
    color: var(--color-text-primary);
}
</style>

<template>
    <div class="gpp">
        <div class="gpp__title">
            <i class="fas fa-shield-halved" /> Effective policy
        </div>
        <div class="gpp__rows">
            <div class="gpp__row">
                <span class="gpp__label">Severity floor</span>
                <span class="gpp__value">
                    <AlertSeverityBadge
                        v-if="group.effectiveSeverityFloor"
                        :severity="group.effectiveSeverityFloor"
                    />
                    <span v-else class="gpp__empty">—</span>
                </span>
                <PolicySourceBadge v-if="sources" :source="sources.severityFloor" />
            </div>
            <div class="gpp__row">
                <span class="gpp__label">Retention</span>
                <span class="gpp__value">
                    <template v-if="group.effectiveRetentionDays != null">
                        {{ group.effectiveRetentionDays }} days
                    </template>
                    <span v-else class="gpp__empty">—</span>
                </span>
                <PolicySourceBadge v-if="sources" :source="sources.retentionDays" />
            </div>
            <div class="gpp__row">
                <span class="gpp__label">Audit retention</span>
                <span class="gpp__value">
                    <template v-if="group.effectiveAuditRetentionDays != null">
                        {{ group.effectiveAuditRetentionDays }} days
                    </template>
                    <span v-else class="gpp__empty">—</span>
                </span>
                <PolicySourceBadge v-if="sources" :source="sources.auditRetentionDays" />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type {Group} from '@api/group';
import {computed} from 'vue';
import AlertSeverityBadge from '@/components/core/AlertSeverityBadge.vue';
import PolicySourceBadge from '@/components/core/PolicySourceBadge.vue';

// Pure presentation; source provenance comes from backend.
const props = defineProps<{group: Group}>();

const sources = computed(() => props.group.policySources ?? null);
</script>

<style scoped>
.gpp {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--gap-md);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
}
.gpp__title {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-body);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-tertiary);
}
.gpp__title i {
    color: var(--color-primary);
    opacity: 0.8;
}
.gpp__rows {
    display: grid;
    grid-template-columns: max-content 1fr max-content;
    gap: var(--space-1) var(--space-3);
    align-items: center;
}
.gpp__row {
    display: contents;
}
.gpp__label {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.gpp__value {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-primary);
}
.gpp__empty {
    color: var(--color-text-disabled);
}
</style>

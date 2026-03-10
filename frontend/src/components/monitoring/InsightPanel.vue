<template>
    <div v-if="insights.length > 0" class="space-y-2">
        <div
            v-for="insight in insights"
            :key="insight.title"
            class="insight-card flex items-start gap-3 p-3 rounded-lg border"
            :class="insight.severity === 'critical'
                ? 'insight-card--critical'
                : 'insight-card--warning'"
        >
            <i :class="[insight.icon, 'text-sm mt-0.5 flex-shrink-0', insight.severity === 'critical' ? 'insight-icon--critical' : 'insight-icon--warning']"
            />
            <div class="min-w-0">
                <div class="text-sm font-semibold" :class="insight.severity === 'critical' ? 'insight-title--critical' : 'insight-title--warning'">
                    {{ insight.title }}
                </div>
                <p class="insight-card__description text-xs mt-0.5">{{ insight.description }}</p>
                <p class="text-xs mt-1 flex items-center gap-1">
                    <i class="fa-solid fa-lightbulb insight-card__tip-icon" />
                    <span class="insight-card__tip-text">{{ insight.action }}</span>
                </p>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
export interface Insight {
    icon: string;
    title: string;
    description: string;
    action: string;
    severity: 'critical' | 'warning';
}

defineProps<{
    insights: Insight[];
}>();
</script>

<style scoped>
/* --- Card severity variants --- */
.insight-card--critical {
    background-color: color-mix(in srgb, var(--color-danger) 12%, transparent);
    border-color: color-mix(in srgb, var(--color-danger) 30%, transparent);
}
.insight-card--warning {
    background-color: color-mix(in srgb, var(--color-warning) 10%, transparent);
    border-color: color-mix(in srgb, var(--color-warning) 22%, transparent);
}

/* --- Icon severity --- */
.insight-icon--critical { color: var(--color-danger-text); }
.insight-icon--warning  { color: var(--color-warning-text); }

/* --- Title severity --- */
.insight-title--critical { color: var(--color-danger-text); }
.insight-title--warning  { color: var(--color-warning-text); }

/* --- Shared elements --- */
.insight-card__description { color: var(--color-text-tertiary); }
.insight-card__tip-icon { color: var(--color-primary-text); }
.insight-card__tip-text { color: var(--color-primary-text); }
</style>

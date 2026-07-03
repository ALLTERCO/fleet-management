<template>
    <div class="btg">
        <template v-if="visibleSections.length > 0">
            <section
                v-for="section in visibleSections"
                :key="section.category"
                class="btg__section"
            >
                <header class="btg__sec-hd">
                    <span
                        class="btg__sec-dot"
                        :style="{background: dotColor(section.category)}"
                        aria-hidden="true"
                    />
                    <span class="btg__sec-title">{{ section.category }}</span>
                </header>

                <div class="btg__grid">
                    <button
                        v-for="template in section.templates"
                        :key="template.templateKey"
                        type="button"
                        class="btg__card"
                        :class="`btg__card--${template.severity}`"
                        @click="emit('pick', template)"
                    >
                        <AlertSeverityBadge :severity="template.severity" />
                        <h5 class="btg__card-title">{{ template.label }}</h5>
                        <p v-if="template.description" class="btg__card-desc">
                            {{ template.description }}
                        </p>
                    </button>
                </div>
            </section>
        </template>

        <p v-else-if="!loading" class="btg__empty">
            No templates match “{{ props.query }}”.
        </p>
    </div>
</template>

<script setup lang="ts">
import type {AlertRuleTemplate} from '@api/alert';
import {computed, onMounted, ref} from 'vue';
import AlertSeverityBadge from '@/components/core/AlertSeverityBadge.vue';
import {groupTemplatesByCategory} from '@/helpers/alertTemplateGrouping';
import {useAlertsStore} from '@/stores/alerts';

// Search text is owned by the parent so one bar drives both pickers.
const props = withDefaults(defineProps<{query?: string}>(), {query: ''});

const emit = defineEmits<{
    pick: [template: AlertRuleTemplate];
}>();

// Starter templates are the single backend source (Rule.ListTemplates).
const store = useAlertsStore();
const templates = ref<AlertRuleTemplate[]>([]);
const loading = ref(true);

onMounted(async () => {
    try {
        templates.value = await store.listTemplates();
    } finally {
        loading.value = false;
    }
});

const visibleSections = computed(() => {
    const term = props.query.toLowerCase();
    const groups = groupTemplatesByCategory(templates.value);
    if (term.length === 0) return groups;
    return groups
        .map((section) => ({
            ...section,
            templates: section.templates.filter((t) => matches(t, term))
        }))
        .filter((section) => section.templates.length > 0);
});

function matches(template: AlertRuleTemplate, term: string): boolean {
    return (
        template.label.toLowerCase().includes(term) ||
        (template.description?.toLowerCase().includes(term) ?? false) ||
        template.kind.toLowerCase().includes(term) ||
        template.category.toLowerCase().includes(term)
    );
}

// Each category gets its own dot colour, like the device-tab section markers.
const CATEGORY_COLOR: Record<string, string> = {
    Connectivity: 'var(--color-primary)',
    Power: 'var(--color-warning)',
    Energy: 'var(--color-warning)',
    Safety: 'var(--color-danger)',
    Activity: 'var(--accent-purple, var(--color-primary))',
    Environment: 'var(--color-info)',
    State: 'var(--color-success)',
    Operations: 'var(--color-text-secondary)',
    Controls: 'var(--color-success)'
};
function dotColor(category: string): string {
    return CATEGORY_COLOR[category] ?? 'var(--color-primary)';
}
</script>

<style scoped>
.btg {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
}

/* ── Category sections — matches the device-tab separators ──────────── */
.btg__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.btg__sec-hd {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--color-frost);
    opacity: 0.75;
}

.btg__sec-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
}

.btg__sec-title {
    font-size: var(--type-body);
    font-weight: 700;
}

/* Trailing rule that fills the row — same as the device-tab separators. */
.btg__sec-hd::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--color-border-default);
}

/* ── Template cards — centred badge, name, description ──────────────── */
.btg__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: var(--space-3);
}

.btg__card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-4);
    background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    color: var(--color-text-primary);
    cursor: pointer;
    text-align: center;
    transition:
        border-color var(--duration-fast) var(--ease-out-expo),
        background-color var(--duration-fast) var(--ease-out-expo),
        box-shadow var(--duration-fast) var(--ease-out-expo);
}

.btg__card:hover {
    background-color: var(--color-surface-3);
    border-color: var(--color-primary);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-primary) 28%, transparent);
}

.btg__card--critical:hover {
    border-color: var(--color-alert-critical-border);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-alert-critical-border) 28%, transparent);
}

.btg__card--warning:hover {
    border-color: var(--color-alert-warning-border);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-alert-warning-border) 28%, transparent);
}

.btg__card-title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}

.btg__card-desc {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
}

.btg__empty {
    padding: var(--space-6);
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
</style>

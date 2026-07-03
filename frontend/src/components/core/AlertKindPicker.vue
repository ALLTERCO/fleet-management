<template>
    <div class="akp">
        <template v-if="visibleSections.length > 0">
            <section
                v-for="section in visibleSections"
                :key="section.category"
                class="akp__section"
            >
                <header class="akp__sec-hd">
                    <span
                        class="akp__sec-dot"
                        :style="{background: `var(${section.kinds[0].colorToken})`}"
                        aria-hidden="true"
                    />
                    <span class="akp__sec-title">{{ section.label }}</span>
                </header>

                <div class="akp__grid">
                    <button
                        v-for="kind in section.kinds"
                        :key="kind.key"
                        type="button"
                        class="akp__card"
                        :style="{'--akp-color': `var(${kind.colorToken})`}"
                        @click="pick(kind.key)"
                    >
                        <i
                            :class="['akp__card-icon', kind.icon]"
                            aria-hidden="true"
                        />
                        <h5 class="akp__card-title">{{ kind.label }}</h5>
                        <p class="akp__card-desc">{{ kind.description }}</p>
                    </button>
                </div>
            </section>
        </template>

        <p v-else class="akp__empty">No alert types match “{{ props.query }}”.</p>
    </div>
</template>

<script setup lang="ts">
import type {AlertRuleKind} from '@api/alert';
import {computed} from 'vue';
import {
    groupRuleKindsByCategory,
    type RuleKindMeta
} from '@/helpers/ruleKinds';

// Search text is owned by the parent so one bar drives both pickers.
const props = withDefaults(defineProps<{query?: string}>(), {query: ''});

const emit = defineEmits<{
    pick: [kind: AlertRuleKind];
}>();

const visibleSections = computed(() => {
    const term = props.query.toLowerCase();
    if (term.length === 0) return groupRuleKindsByCategory();
    return groupRuleKindsByCategory()
        .map((section) => ({
            ...section,
            kinds: section.kinds.filter((meta) => matches(meta, term))
        }))
        .filter((section) => section.kinds.length > 0);
});

function matches(meta: RuleKindMeta, term: string): boolean {
    return (
        meta.label.toLowerCase().includes(term) ||
        meta.description.toLowerCase().includes(term) ||
        meta.key.toLowerCase().includes(term)
    );
}

function pick(kind: AlertRuleKind): void {
    emit('pick', kind);
}
</script>

<style scoped>
.akp {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
}

/* ── Category sections — match the template gallery ─────────────────── */
.akp__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.akp__sec-hd {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--color-frost);
    opacity: 0.75;
}

.akp__sec-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
}

.akp__sec-title {
    font-size: var(--type-body);
    font-weight: 700;
}

.akp__sec-hd::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--color-border-default);
}

/* ── Cards — centred icon, name, description ────────────────────────── */
.akp__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: var(--space-3);
}

.akp__card {
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

.akp__card:hover {
    background-color: var(--color-surface-3);
    border-color: var(--akp-color);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--akp-color) 30%, transparent);
}

.akp__card-icon {
    color: var(--akp-color);
    font-size: var(--type-subheading);
}

.akp__card-title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}

.akp__card-desc {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
}

.akp__empty {
    padding: var(--space-6);
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
</style>

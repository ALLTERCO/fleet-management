<template>
    <PageTemplate
        fill
        :selectable="canWrite"
        v-model:search="nameFilter"
        title="Templates"
        :tabs="tabs"
        :stats="headerStats"
        :searchable="true"
        search-placeholder="Search templates..."
        :scope="scope"
        :items="filteredTemplates"
        :item-key="templateKey"
        pagination-mode="infinite"
        :page-size="200"
        :loading="loading && allTemplates.length === 0"
        :empty="filteredTemplates.length === 0 && !loading"
        :empty-title="emptyTitle"
        :empty-sub="emptySub"
        :skeleton-count="6"
    >
        <template #actions>
            <Button
                v-if="canWrite"
                type="green"
                size="sm"
                title="New template"
                aria-label="New template"
                @click="openCreate"
            >
                <i class="fas fa-plus" aria-hidden="true" />
            </Button>
        </template>

        <template #empty-cta>
            <Button
                v-if="canWrite && !nameFilter"
                type="green"
                @click="openCreate"
            >
                Create template
            </Button>
        </template>

        <template #item="{item, selecting, selected, toggleSelect}">
            <article
                class="mt-card"
                :class="{'mt-card--on': selected}"
                role="button"
                tabindex="0"
                @click="selecting ? toggleSelect() : openEdit(item)"
                @keydown.enter="selecting ? toggleSelect() : openEdit(item)"
            >
                <div class="mt-card__icon">
                    <i class="fas fa-comment-dots" aria-hidden="true" />
                </div>
                <div class="mt-card__name-wrap">
                    <h3 class="mt-card__name" :title="item.name">{{ item.name }}</h3>
                </div>
                <div class="mt-card__foot">
                    <span :class="{'mt-card__part--off': !item.bodies.email}" title="Email">
                        <i class="fas fa-envelope" aria-hidden="true" />
                    </span>
                    <span :class="{'mt-card__part--off': !item.bodies.slack}" title="Slack">
                        <i class="fab fa-slack" aria-hidden="true" />
                    </span>
                    <span :class="{'mt-card__part--off': !item.bodies.teams}" title="Teams">
                        <i class="fab fa-microsoft" aria-hidden="true" />
                    </span>
                </div>
            </article>
        </template>

        <template #bulk-actions="{selectedItems, clear}">
            <Button
                type="red"
                size="sm"
                title="Delete"
                aria-label="Delete selected"
                @click="askBulkDelete(selectedItems, clear)"
            >
                <i class="fas fa-trash" aria-hidden="true" />
            </Button>
        </template>

        <template #modals>
            <EditMessageTemplateModal
                v-model="modalVisible"
                :mode="modalMode"
                :initial="modalInitial"
                @saved="onSaved"
            />
            <ConfirmationModal ref="confirmDeleteRef">
                <template #title>
                    <h3>{{ pendingDeleteLabel }}</h3>
                </template>
                <template #default>
                    <p class="mt__confirm">
                        Rules using this template fall back to their own wording.
                    </p>
                </template>
            </ConfirmationModal>
        </template>
    </PageTemplate>
</template>

<script setup lang="ts">
import {
    type ComputedRef,
    computed,
    inject,
    onMounted,
    ref
} from 'vue';
import Button from '@/components/core/Button.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import EditMessageTemplateModal from '@/components/modals/EditMessageTemplateModal.vue';
import {useFuzzySearch} from '@/composables/useFuzzySearch';
import {usePermissions} from '@/composables/usePermissions';
import type {PageScope} from '@/composables/useUniversalSearch';
import {type MessageTemplate, useAlertsStore} from '@/stores/alerts';
import type {RouteTab, StatItem} from '@/types/page-template';

const store = useAlertsStore();
const {canWrite} = usePermissions();

const tabs = inject<ComputedRef<RouteTab[]>>('alertTabs', computed(() => []));

const nameFilter = ref('');
const loading = ref(true);

const modalVisible = ref(false);
const modalMode = ref<'create' | 'edit'>('create');
const modalInitial = ref<MessageTemplate | null>(null);

const confirmDeleteRef = ref<InstanceType<typeof ConfirmationModal>>();
const pendingDeleteLabel = ref('');

function templateKey(t: MessageTemplate): number {
    return t.id;
}

const allTemplates = computed<MessageTemplate[]>(() =>
    Object.values(store.templates).sort((a, b) => a.name.localeCompare(b.name))
);

const filteredTemplates = useFuzzySearch(allTemplates, nameFilter, {
    keys: ['name', 'description']
});

const headerStats = computed<StatItem[]>(() => [
    {value: allTemplates.value.length, label: 'templates', status: 'on'}
]);

const emptyTitle = computed(() =>
    nameFilter.value ? 'No templates match' : 'No templates yet'
);

const emptySub = computed(() => {
    if (nameFilter.value) return 'Try a different search term.';
    return 'Save a reusable message — email, Slack, Teams, and a text fallback — and point alert rules at it.';
});

const scope: PageScope<MessageTemplate> = {
    type: 'Template',
    icon: 'fas fa-comment-dots',
    items: allTemplates,
    keys: ['name', 'description'] as const,
    toHit: (t) => ({
        id: `alert-template-${t.id}`,
        label: t.name,
        meta: t.description ?? '',
        type: 'Template',
        icon: 'fas fa-comment-dots',
        route: '/alerts/templates'
    })
};

onMounted(async () => {
    loading.value = true;
    try {
        await store.fetchTemplates();
    } finally {
        loading.value = false;
    }
});

function openCreate() {
    modalMode.value = 'create';
    modalInitial.value = null;
    modalVisible.value = true;
}

function openEdit(t: MessageTemplate) {
    modalMode.value = 'edit';
    modalInitial.value = t;
    modalVisible.value = true;
}

function askBulkDelete(items: MessageTemplate[], clear: () => void): void {
    pendingDeleteLabel.value =
        items.length === 1
            ? `Delete "${items[0].name}"?`
            : `Delete ${items.length} templates?`;
    confirmDeleteRef.value?.storeAction(async () => {
        await Promise.all(items.map((t) => store.deleteTemplate(t.id)));
        clear();
    });
}

function onSaved() {
    // Store upserts already — no refetch needed.
}
</script>

<style scoped>
.mt__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, var(--grid-cell, 200px));
    grid-auto-rows: auto;
    justify-content: start;
    gap: var(--card-grid-gap, 12px);
}

/* Square card, sibling of the rule / device / group cards. */
.mt-card {
    position: relative;
    display: flex;
    flex-direction: column;
    width: var(--grid-cell, 200px);
    height: 234px;
    padding: var(--space-3);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    cursor: pointer;
    overflow: hidden;
    transition:
        border-color var(--duration-fast),
        box-shadow var(--duration-fast),
        transform var(--duration-fast);
}
.mt-card:hover {
    border-color: var(--color-primary);
    box-shadow: var(--shadow-brand-ring);
    transform: translateY(-2px);
}
.mt-card:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}

.mt-card--on {
    border-color: var(--color-primary);
    box-shadow: var(--shadow-brand-ring);
}

.mt-card__icon {
    flex: none;
    align-self: center;
    margin-top: var(--space-4);
    width: var(--icon-size-2xl);
    height: var(--icon-size-2xl);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-lg);
    font-size: var(--icon-size-xl);
    color: rgb(var(--color-info-rgb));
    background: rgba(var(--color-info-rgb), 0.12);
    box-shadow:
        0 0 0 1px rgba(var(--color-info-rgb), 0.22),
        0 0 22px rgba(var(--color-info-rgb), 0.14);
}

.mt-card__name-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2) var(--space-1);
}
.mt-card__name {
    margin: 0;
    font-size: var(--type-body);
    font-weight: 700;
    line-height: 1.32;
    text-align: center;
    color: var(--color-text-primary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.mt-card__foot {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-border-default);
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
}
.mt-card__foot span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
}
.mt-card__part--off {
    opacity: 0.35;
}

.mt__confirm {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    line-height: 1.5;
}
</style>

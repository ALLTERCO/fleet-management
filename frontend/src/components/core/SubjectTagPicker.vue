<template>
    <div class="stp">
        <div class="stp__row">
            <template v-if="attached.length > 0">
                <TagChip
                    v-for="tag in attached"
                    :key="tag.id"
                    :tag="tag"
                    removable
                    @remove="toggleTag(tag.id)"
                />
            </template>
            <span v-else-if="!loading" class="stp__empty">No tags</span>
            <span v-else class="stp__empty">Loading tags…</span>

            <button
                type="button"
                class="stp__add-btn"
                :class="{'stp__add-btn--open': open}"
                :disabled="loading"
                :aria-expanded="open"
                @click="togglePicker"
            >
                <i :class="open ? 'fas fa-xmark' : 'fas fa-plus'" />
                {{ open ? 'Cancel' : 'Add tag' }}
            </button>
        </div>

        <div v-if="open" class="stp__panel">
            <input
                ref="searchInputRef"
                v-model="search"
                type="text"
                placeholder="Search tags…"
                class="stp__search"
                @keydown.escape="closePicker"
            />
            <div v-if="filteredAddable.length > 0" class="stp__list">
                <button
                    v-for="tag in filteredAddable"
                    :key="tag.id"
                    type="button"
                    class="stp__list-row"
                    @click="toggleTag(tag.id)"
                >
                    <TagChip :tag="tag" />
                    <span v-if="tag.description" class="stp__list-desc">
                        {{ tag.description }}
                    </span>
                </button>
            </div>
            <div v-else class="stp__empty stp__empty--panel">
                {{ search ? 'No matches' : 'No more tags available' }}
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, nextTick, ref, watch} from 'vue';
import TagChip from '@/components/core/TagChip.vue';
import {type ApiTag, type TagSubjectType, useTagsStore} from '@/stores/tags';

const props = defineProps<{
    subjectType: TagSubjectType;
    subjectId: string;
}>();

const tagsStore = useTagsStore();

const attachedIds = ref<number[]>([]);
const loading = ref(true);
const open = ref(false);
const search = ref('');
const searchInputRef = ref<HTMLInputElement | null>(null);

async function ensureTagsLoaded(): Promise<void> {
    // Lazy-load on first mount so the picker has options to show; without
    // this, the addable list is empty until something else fetches the store.
    if (Object.keys(tagsStore.tags).length === 0) {
        await tagsStore.fetchTags();
    }
}

async function reload(): Promise<void> {
    loading.value = true;
    try {
        await ensureTagsLoaded();
        attachedIds.value = await tagsStore.listTagsForSubject(
            props.subjectType,
            props.subjectId
        );
    } finally {
        loading.value = false;
    }
}

watch(
    () => [props.subjectType, props.subjectId] as const,
    () => {
        void reload();
    },
    {immediate: true}
);

const attached = computed<ApiTag[]>(() =>
    attachedIds.value
        .map((id) => tagsStore.tags[id])
        .filter((t): t is ApiTag => !!t)
);

const addable = computed<ApiTag[]>(() => {
    const have = new Set(attachedIds.value);
    return Object.values(tagsStore.tags)
        .filter((t) => !have.has(t.id))
        .sort((a, b) => a.name.localeCompare(b.name));
});

const filteredAddable = computed<ApiTag[]>(() => {
    const q = search.value.trim().toLowerCase();
    if (!q) return addable.value;
    return addable.value.filter(
        (t) =>
            t.name.toLowerCase().includes(q) ||
            (t.description ?? '').toLowerCase().includes(q)
    );
});

function togglePicker(): void {
    open.value = !open.value;
    if (open.value) {
        void nextTick(() => searchInputRef.value?.focus());
    } else {
        search.value = '';
    }
}

function closePicker(): void {
    open.value = false;
    search.value = '';
}

async function toggleTag(tagId: number): Promise<void> {
    const have = attachedIds.value.includes(tagId);
    const ok = have
        ? await tagsStore.unassignSubjects(tagId, [
              {subjectType: props.subjectType, subjectId: props.subjectId}
          ])
        : await tagsStore.assignSubjects(tagId, [
              {subjectType: props.subjectType, subjectId: props.subjectId}
          ]);
    if (ok) await reload();
}
</script>

<style scoped>
.stp {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}
.stp__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1-5);
}
.stp__empty {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    font-style: italic;
}
.stp__add-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--gap-xs);
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    background: transparent;
    border: 1px dashed var(--color-border-medium);
    border-radius: var(--radius-full);
    cursor: pointer;
    transition:
        background var(--duration-fast),
        border-color var(--duration-fast),
        color var(--duration-fast);
    line-height: 1;
}
.stp__add-btn:hover:not(:disabled) {
    background: var(--color-surface-2);
    border-color: var(--color-border-strong);
    color: var(--color-text-primary);
}
.stp__add-btn:disabled {
    opacity: 0.5;
    cursor: progress;
}
.stp__add-btn--open {
    background: var(--color-surface-2);
    border-style: solid;
    border-color: var(--color-border-strong);
    color: var(--color-text-primary);
}
.stp__panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    max-height: 280px;
    overflow-y: auto;
}
.stp__search {
    width: 100%;
    padding: var(--space-1-5) var(--space-2);
    font-size: var(--type-caption);
    color: var(--color-text-primary);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    outline: none;
}
.stp__search:focus {
    border-color: var(--color-primary);
}
.stp__search::placeholder {
    color: var(--color-text-tertiary);
}
.stp__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
}
.stp__list-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-1-5);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
    transition: background var(--duration-fast);
}
.stp__list-row:hover {
    background: var(--color-surface-2);
}
.stp__list-desc {
    flex: 1;
    min-width: 0;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.stp__empty--panel {
    padding: var(--space-2);
    text-align: center;
}
</style>

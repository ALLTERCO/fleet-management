<template>
    <div class="irlp">
        <div class="irlp__toolbar">
            <Input
                v-model="search"
                type="search"
                placeholder="Search codes"
                aria-label="Search IR codes"
            />
            <div class="irlp__tools">
                <Button
                    type="blue-hollow"
                    size="sm"
                    @click="toggleSection('catalog')"
                    >Browse catalog</Button
                >
                <Button
                    type="blue-hollow"
                    size="sm"
                    @click="toggleSection('import')"
                    >Import file</Button
                >
                <Button
                    v-if="shellyID"
                    type="blue-hollow"
                    size="sm"
                    @click="toggleSection('learn')"
                    >Save from device</Button
                >
                <Button
                    type="blue"
                    size="sm"
                    :disabled="selectedIds.length === 0"
                    @click="toggleSection('push')"
                    >Push selected ({{ selectedIds.length }})</Button
                >
            </div>
        </div>

        <IrCatalogBrowser
            v-if="openSection === 'catalog'"
            class="irlp__section"
            @imported="onImported"
        />
        <IrLibraryImport
            v-if="openSection === 'import'"
            class="irlp__section"
            @imported="onImported"
        />
        <IrSaveLearnedPanel
            v-if="openSection === 'learn' && shellyID"
            class="irlp__section"
            :shelly-i-d="shellyID"
            @saved="refresh"
        />
        <IrPushPanel
            v-if="openSection === 'push'"
            class="irlp__section"
            :entry-ids="selectedIds"
            :fixed-shelly-id="shellyID"
        />

        <div v-if="store.loading" class="irlp__empty"><Spinner /></div>
        <div v-else-if="filteredEntries.length === 0" class="irlp__empty">
            No IR codes in the library yet. Browse the catalog, import a
            file, or save codes from a device.
        </div>
        <ul v-else class="irlp__list">
            <li
                v-for="entry in filteredEntries"
                :key="entry.id"
                class="irlp__entry"
            >
                <Checkbox
                    :model-value="selected.has(entry.id)"
                    :aria-label="`Select ${entry.name}`"
                    @update:model-value="(v: boolean) => setSelected(entry.id, v)"
                />
                <div class="irlp__entry-main">
                    <span class="irlp__entry-name">{{ entry.name }}</span>
                    <span class="irlp__entry-meta">
                        {{ entryMeta(entry) }}
                    </span>
                </div>
                <span class="irlp__entry-source">{{
                    SOURCE_LABELS[entry.source]
                }}</span>
                <button
                    type="button"
                    class="irlp__delete"
                    :aria-label="`Delete ${entry.name}`"
                    @click="remove(entry.id)"
                >
                    <i class="fas fa-trash" aria-hidden="true" />
                </button>
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from 'vue';
import Button from '@/components/core/Button.vue';
import Checkbox from '@/components/core/Checkbox.vue';
import Input from '@/components/core/Input.vue';
import Spinner from '@/components/core/Spinner.vue';
import IrCatalogBrowser from '@/components/ir/IrCatalogBrowser.vue';
import IrLibraryImport from '@/components/ir/IrLibraryImport.vue';
import IrPushPanel from '@/components/ir/IrPushPanel.vue';
import IrSaveLearnedPanel from '@/components/ir/IrSaveLearnedPanel.vue';
import {type IrLibraryEntry, useIrLibraryStore} from '@/stores/irLibrary';

// Optional device context (device board). Without it the panel is a plain
// org-library browser reusable on a standalone page.
const props = defineProps<{shellyID?: string}>();

const SOURCE_LABELS: Record<IrLibraryEntry['source'], string> = {
    learned: 'Learned',
    import_irdb: 'IRDB',
    import_flipper: 'Flipper',
    manual: 'Manual'
};

type Section = 'catalog' | 'import' | 'learn' | 'push' | null;

const store = useIrLibraryStore();
const search = ref('');
const selected = ref(new Set<number>());
const openSection = ref<Section>(null);

onMounted(() => {
    void store.fetchEntries();
});

const allEntries = computed(() =>
    Object.values(store.entries).sort(
        (a, b) =>
            (a.brand ?? '').localeCompare(b.brand ?? '') ||
            a.name.localeCompare(b.name)
    )
);

const filteredEntries = computed(() => {
    const q = search.value.trim().toLowerCase();
    if (!q) return allEntries.value;
    return allEntries.value.filter((e) =>
        [e.name, e.brand, e.deviceType, e.protocol].some(
            (v) => v?.toLowerCase().includes(q)
        )
    );
});

const selectedIds = computed(() =>
    [...selected.value].filter((id) => store.entries[id])
);

function entryMeta(entry: IrLibraryEntry): string {
    return [entry.brand, entry.deviceType, entry.protocol]
        .filter(Boolean)
        .join(' · ');
}

function setSelected(id: number, value: boolean): void {
    const next = new Set(selected.value);
    if (value) next.add(id);
    else next.delete(id);
    selected.value = next;
}

function toggleSection(section: Exclude<Section, null>): void {
    openSection.value = openSection.value === section ? null : section;
}

function refresh(): void {
    void store.fetchEntries();
}

function onImported(): void {
    openSection.value = null;
}

async function remove(id: number): Promise<void> {
    if (await store.deleteEntry(id)) setSelected(id, false);
}
</script>

<style scoped>
.irlp {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.irlp__toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    flex-wrap: wrap;
}
.irlp__tools {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
}
.irlp__section {
    padding: var(--space-3);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
}
.irlp__empty {
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    padding: var(--space-3) 0;
}
.irlp__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-height: 20rem;
    overflow-y: auto;
    margin: 0;
    padding: 0;
    list-style: none;
}
.irlp__entry {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-2);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
}
.irlp__entry-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
}
.irlp__entry-name {
    color: var(--color-text-primary);
    font-size: var(--type-body);
    overflow-wrap: anywhere;
}
.irlp__entry-meta {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.irlp__entry-source {
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    padding: 0 var(--space-1-5);
    background: var(--color-surface-3);
    border-radius: var(--radius-sm);
    flex-shrink: 0;
}
.irlp__delete {
    display: inline-grid;
    place-items: center;
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    background: transparent;
    border: none;
    border-radius: var(--radius-md);
    color: var(--color-text-tertiary);
    cursor: pointer;
    flex-shrink: 0;
}
.irlp__delete:hover {
    color: var(--color-danger-text);
    background: var(--color-danger-subtle);
}
</style>

<template>
    <div class="ircb">
        <div class="ircb__toolbar">
            <Input
                v-model="search"
                type="search"
                placeholder="Search brands and remotes"
                aria-label="Search IR catalog"
            />
            <div class="ircb__types" role="group" aria-label="Device type">
                <Button
                    :type="typeFilter === null ? 'blue' : 'blue-hollow'"
                    size="sm"
                    @click="typeFilter = null"
                    >All</Button
                >
                <Button
                    v-for="deviceType in deviceTypes"
                    :key="deviceType"
                    :type="typeFilter === deviceType ? 'blue' : 'blue-hollow'"
                    size="sm"
                    @click="typeFilter = deviceType"
                    >{{ deviceType }}</Button
                >
            </div>
        </div>

        <div v-if="store.catalogLoading" class="ircb__empty"><Spinner /></div>
        <div v-else-if="filteredRemotes.length === 0" class="ircb__empty">
            No catalog remotes match.
        </div>
        <ul v-else class="ircb__list">
            <li
                v-for="remote in filteredRemotes"
                :key="remote.id"
                class="ircb__remote"
            >
                <Checkbox
                    :model-value="selected.has(remote.id)"
                    :aria-label="`Select ${remote.name}`"
                    @update:model-value="
                        (v: boolean) => setSelected(remote.id, v)
                    "
                />
                <div class="ircb__remote-main">
                    <span class="ircb__remote-name">{{ remote.name }}</span>
                    <span class="ircb__remote-meta">{{
                        remoteMeta(remote)
                    }}</span>
                </div>
            </li>
        </ul>

        <div class="ircb__actions">
            <Button
                type="blue"
                size="sm"
                :disabled="selectedIds.length === 0"
                :loading="importing"
                @click="importSelected"
                >Add selected to library ({{ selectedIds.length }})</Button
            >
        </div>

        <p class="ircb__note">
            Bundled from the community
            <a
                class="ircb__link"
                href="https://github.com/logickworkshop/Flipper-IRDB"
                target="_blank"
                rel="noopener noreferrer"
                >Flipper-IRDB</a
            >
            collection (CC0-1.0). Need a remote that is not here? Download a
            file from Flipper-IRDB or
            <a
                class="ircb__link"
                href="https://github.com/probonopd/irdb"
                target="_blank"
                rel="noopener noreferrer"
                >irdb</a
            >
            yourself and use Import file.
        </p>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from 'vue';
import Button from '@/components/core/Button.vue';
import Checkbox from '@/components/core/Checkbox.vue';
import Input from '@/components/core/Input.vue';
import Spinner from '@/components/core/Spinner.vue';
import {type IrCatalogRemote, useIrLibraryStore} from '@/stores/irLibrary';
import {useToastStore} from '@/stores/toast';

// Matches the backend IR_CATALOG_IMPORT_MAX_REMOTES cap per RPC call.
const IMPORT_CHUNK = 20;

const emit = defineEmits<{imported: [count: number]}>();

const store = useIrLibraryStore();
const toast = useToastStore();

const search = ref('');
const typeFilter = ref<string | null>(null);
const selected = ref(new Set<string>());
const importing = ref(false);

onMounted(() => {
    if (store.catalog.length === 0) void store.fetchCatalog();
});

const deviceTypes = computed(() =>
    [...new Set(store.catalog.map((r) => r.deviceType))].sort()
);

const filteredRemotes = computed(() => {
    const q = search.value.trim().toLowerCase();
    return store.catalog
        .filter((r) => {
            if (typeFilter.value && r.deviceType !== typeFilter.value) {
                return false;
            }
            if (!q) return true;
            return [r.name, r.brand, r.deviceType].some((field) =>
                field.toLowerCase().includes(q)
            );
        })
        .sort(
            (a, b) =>
                a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name)
        );
});

const selectedIds = computed(() =>
    [...selected.value].filter((id) =>
        store.catalog.some((r) => r.id === id)
    )
);

function remoteMeta(remote: IrCatalogRemote): string {
    const codes = `${remote.codeCount} ${
        remote.codeCount === 1 ? 'code' : 'codes'
    }`;
    return [remote.brand, remote.deviceType, codes].join(' · ');
}

function setSelected(id: string, value: boolean): void {
    const next = new Set(selected.value);
    if (value) next.add(id);
    else next.delete(id);
    selected.value = next;
}

async function importSelected(): Promise<void> {
    importing.value = true;
    try {
        const ids = selectedIds.value;
        let imported = 0;
        for (let i = 0; i < ids.length; i += IMPORT_CHUNK) {
            const result = await store.importCatalog(
                ids.slice(i, i + IMPORT_CHUNK)
            );
            // Store already toasted the failure; keep the selection so the
            // user can retry.
            if (!result) return;
            imported += result.imported;
        }
        toast.success(
            `Imported ${imported} ${imported === 1 ? 'code' : 'codes'}`
        );
        selected.value = new Set();
        emit('imported', imported);
    } finally {
        importing.value = false;
    }
}
</script>

<style scoped>
.ircb {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.ircb__toolbar {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.ircb__types {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
}
.ircb__empty {
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    padding: var(--space-3) 0;
}
.ircb__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-height: 18rem;
    overflow-y: auto;
    margin: 0;
    padding: 0;
    list-style: none;
}
.ircb__remote {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-2);
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
}
.ircb__remote-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
}
.ircb__remote-name {
    color: var(--color-text-primary);
    font-size: var(--type-body);
    overflow-wrap: anywhere;
}
.ircb__remote-meta {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.ircb__actions {
    display: flex;
    gap: var(--space-2);
}
.ircb__note {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.ircb__link {
    color: var(--color-link);
}
.ircb__link:hover {
    color: var(--color-link-hover);
}
</style>

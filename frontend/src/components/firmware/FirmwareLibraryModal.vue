<template>
    <Modal :visible="visible" wide @close="emit('close')">
        <template #title>Firmware Library</template>

        <div class="flex flex-col" style="gap: var(--space-5)">
            <!-- Search -->
            <div class="fw-lib-search">
                <i class="fas fa-search fw-lib-search__icon" />
                <input
                    v-model="search"
                    type="search"
                    class="fw-lib-search__input"
                    aria-label="Search firmware library"
                />
                <button v-if="search" type="button" class="fw-lib-search__clear" @click="search = ''">
                    <i class="fas fa-xmark" />
                </button>
            </div>

            <!-- Loading -->
            <div v-if="loading" class="flex items-center justify-center py-8 text-[var(--color-text-disabled)]">
                <Spinner size="sm" class="mr-2" /> Loading library...
            </div>

            <!-- Empty state -->
            <div v-else-if="filteredItems.length === 0" class="flex items-center justify-center py-8 text-[var(--color-text-disabled)]">
                {{ items.length === 0 ? 'No firmware files in the library' : 'No firmware files match your search' }}
            </div>

            <!-- Library items -->
            <div v-else class="fw-lib-list">
                <div v-for="item in filteredItems" :key="item.id" class="fw-lib-item">
                    <div class="fw-lib-item__main">
                        <!-- Inline rename -->
                        <div v-if="editingId === item.id" class="fw-lib-item__edit">
                            <input
                                ref="editInputRef"
                                v-model="editName"
                                class="fw-lib-item__edit-input"
                                @keydown.enter="saveRename(item)"
                                @keydown.escape="cancelRename"
                            />
                            <button type="button" class="fw-lib-item__edit-btn fw-lib-item__edit-btn--save" @click="saveRename(item)">
                                <i class="fas fa-check" />
                            </button>
                            <button type="button" class="fw-lib-item__edit-btn" @click="cancelRename">
                                <i class="fas fa-xmark" />
                            </button>
                        </div>
                        <template v-else>
                            <div class="fw-lib-item__title-row">
                                <span class="fw-lib-item__title">{{ item.name || item.originalFileName }}</span>
                                <button type="button" class="fw-lib-item__rename" title="Rename" @click="startRename(item)">
                                    <i class="fas fa-pen" />
                                </button>
                            </div>
                        </template>
                        <div class="fw-lib-item__meta">
                            <span v-if="item.model" class="fw-lib-item__tag">{{ item.model }}</span>
                            <span v-if="item.app" class="fw-lib-item__tag">{{ item.app }}</span>
                            <span v-if="item.ver" class="fw-lib-item__tag">v{{ item.ver }}</span>
                            <span v-if="item.channel" class="fw-lib-item__tag">{{ item.channel }}</span>
                            <span class="fw-lib-item__size">{{ formatBytes(item.fileSize) }}</span>
                        </div>
                        <div class="fw-lib-item__compat">{{ getCompatibilityLabel(item) }}</div>
                    </div>
                    <div class="fw-lib-item__actions">
                        <Button type="blue" size="xs" narrow :disabled="selectedCount === 0" title="Flash to selected" aria-label="Flash to selected" @click="emit('use', item)">
                            <i class="fas fa-play" aria-hidden="true" />
                        </Button>
                        <Button type="blue-hollow" size="xs" narrow title="Edit metadata" aria-label="Edit metadata" @click="emit('edit', item)">
                            <i class="fas fa-pen" aria-hidden="true" />
                        </Button>
                        <Button type="red" size="xs" narrow title="Delete" aria-label="Delete" @click="emit('delete', item)">
                            <i class="fas fa-trash" aria-hidden="true" />
                        </Button>
                    </div>
                </div>
            </div>
        </div>

        <template #footer>
            <div class="flex justify-end">
                <Button type="blue-hollow" size="sm" @click="emit('close')">Close</Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import type {FirmwareLibraryItem} from '@api/firmware';
import {computed, nextTick, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Spinner from '@/components/core/Spinner.vue';
import Modal from '@/components/modals/Modal.vue';
import {formatBytes} from '@/helpers/format';

// Re-export so existing consumers that imported the type from this
// component keep working; the single source of truth lives under
// `@api/firmware` (backend's `backend/src/types/api/firmware.ts`).
export type {FirmwareLibraryItem};

const props = defineProps<{
    visible: boolean;
    items: FirmwareLibraryItem[];
    loading: boolean;
    selectedCount: number;
    getCompatibilityLabel: (item: FirmwareLibraryItem) => string;
}>();

const emit = defineEmits<{
    close: [];
    use: [item: FirmwareLibraryItem];
    edit: [item: FirmwareLibraryItem];
    delete: [item: FirmwareLibraryItem];
    rename: [item: FirmwareLibraryItem, newName: string];
}>();

const search = ref('');
const editingId = ref<string | null>(null);
const editName = ref('');
const editInputRef = ref<HTMLInputElement | null>(null);

const filteredItems = computed(() => {
    const query = search.value.trim().toLowerCase();
    if (!query) return props.items;
    return props.items.filter((item) =>
        [
            item.name,
            item.originalFileName,
            item.app,
            item.model,
            item.ver,
            item.fwId,
            item.channel,
            ...item.tags
        ]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query))
    );
});

async function startRename(item: FirmwareLibraryItem) {
    editingId.value = item.id;
    editName.value = item.name || item.originalFileName;
    await nextTick();
    editInputRef.value?.focus();
    editInputRef.value?.select();
}

function saveRename(item: FirmwareLibraryItem) {
    const trimmed = editName.value.trim();
    if (trimmed && trimmed !== item.name) {
        emit('rename', item, trimmed);
    }
    editingId.value = null;
}

function cancelRename() {
    editingId.value = null;
}

watch(
    () => props.visible,
    (isVisible) => {
        if (!isVisible) {
            search.value = '';
            editingId.value = null;
        }
    }
);
</script>

<style scoped>
.fw-lib-search {
    position: relative;
}
.fw-lib-search__icon {
    position: absolute;
    left: var(--space-3);
    top: 50%;
    transform: translateY(-50%);
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    pointer-events: none;
}
.fw-lib-search__input {
    width: 100%;
    min-height: var(--touch-target-min);
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-8);
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--btn-radius);
    color: var(--color-text-primary);
    font-size: var(--btn-font-size);
    font-family: inherit;
}
.fw-lib-search__input:focus {
    outline: none;
    border-color: var(--color-border-focus);
}
.fw-lib-search__clear {
    position: absolute;
    right: var(--space-2);
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: var(--color-text-disabled);
    cursor: pointer;
}

.fw-lib-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-height: 400px;
    overflow-y: auto;
}

.fw-lib-item {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-lg);
    padding: var(--space-3);
    background: var(--color-surface-2);
    transition: border-color var(--duration-fast);
}
.fw-lib-item:hover {
    border-color: var(--color-border-medium);
}

.fw-lib-item__main {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.fw-lib-item__title-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.fw-lib-item__title {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.fw-lib-item__rename {
    background: none;
    border: none;
    color: var(--color-text-disabled);
    font-size: var(--type-body);
    cursor: pointer;
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    opacity: 0;
    transition: all var(--duration-fast);
    position: relative;
}
.fw-lib-item__rename::after {
    content: "";
    position: absolute;
    inset: -8px;
}
.fw-lib-item:hover .fw-lib-item__rename {
    opacity: 1;
}
.fw-lib-item__rename:hover {
    color: var(--color-text-primary);
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
}

/* Inline edit */
.fw-lib-item__edit {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.fw-lib-item__edit-input {
    flex: 1;
    min-height: var(--touch-target-min);
    padding: var(--space-2) var(--space-2);
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-focus);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-family: inherit;
}
.fw-lib-item__edit-input:focus {
    outline: none;
}
.fw-lib-item__edit-btn {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--color-text-disabled);
    font-size: var(--type-body);
    cursor: pointer;
    transition: all var(--duration-fast);
}
.fw-lib-item__edit-btn::after {
    content: "";
    position: absolute;
    inset: -5px;
}
.fw-lib-item__edit-btn:hover {
    background: color-mix(in srgb, var(--color-text-tertiary) 10%, transparent);
    color: var(--color-text-primary);
}
.fw-lib-item__edit-btn--save:hover {
    background: color-mix(in srgb, var(--color-success) 12%, transparent);
    color: var(--color-success-text);
}

.fw-lib-item__meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
}
.fw-lib-item__tag {
    padding: 1px var(--space-2);
    background: var(--color-surface-3);
    border-radius: var(--radius-sm);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    font-family: var(--font-mono);
}
.fw-lib-item__size {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    font-family: var(--font-mono);
}

.fw-lib-item__compat {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
}

.fw-lib-item__actions {
    display: flex;
    gap: var(--space-2);
    flex-shrink: 0;
}
</style>

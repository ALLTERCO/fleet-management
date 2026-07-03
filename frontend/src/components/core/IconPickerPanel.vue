<template>
    <div class="ipp">
        <div v-if="hasTabs" class="ipp__tabs">
            <button
                v-for="t in tabs"
                :key="t.value"
                class="ipp__tab"
                :class="t.value === tab && 'ipp__tab--active'"
                @click="tab = t.value"
            >
                <i :class="t.icon" /> {{ t.label }}
            </button>
        </div>

        <div v-if="tab === 'library'" class="ipp__panel">
            <input
                v-model="query"
                type="text"
                class="ipp__search"
                :placeholder="searchPlaceholder"
            />
            <div class="ipp__cats">
                <button
                    class="ipp__chip"
                    :class="cat === null && 'ipp__chip--active'"
                    @click="cat = null"
                >
                    All
                </button>
                <button
                    v-for="c in ICON_CATEGORIES"
                    :key="c.key"
                    class="ipp__chip"
                    :class="cat === c.key && 'ipp__chip--active'"
                    @click="cat = c.key"
                >
                    {{ c.label }}
                </button>
            </div>
            <div class="ipp__grid">
                <button
                    v-for="entry in filteredIcons"
                    :key="entry.cls"
                    type="button"
                    class="ipp__icon"
                    :class="entry.cls === selectedGlyph && 'ipp__icon--selected'"
                    :title="entry.label"
                    @click="emit('pickGlyph', entry.cls)"
                >
                    <i :class="entry.cls" />
                </button>
                <div v-if="!filteredIcons.length" class="ipp__empty">
                    No icons match.
                </div>
            </div>
        </div>

        <div v-else-if="tab === 'upload'" class="ipp__panel">
            <p class="ipp__hint">
                PNG, JPG, WEBP, SVG. 1 MB max. Sanitised on upload.
            </p>
            <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                @change="onPickFile"
            />
            <div v-if="uploadedUrl" class="ipp__preview">
                <img :src="uploadedUrl" alt="Uploaded icon" />
                <span>Stored.</span>
            </div>
        </div>

        <div v-else-if="tab === 'url'" class="ipp__panel">
            <p class="ipp__hint">Paste a public image URL.</p>
            <input
                v-model="urlInput"
                type="url"
                class="ipp__search"
                placeholder="https://example.com/icon.png"
            />
            <button
                class="ipp__url-btn"
                :disabled="!isValidUrl(urlInput)"
                @click="onPickUrl"
            >
                Use this URL
            </button>
            <div v-if="urlInput && isValidUrl(urlInput)" class="ipp__preview">
                <img :src="urlInput" alt="URL preview" />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {
    ICON_CATEGORIES,
    ICON_LIBRARY,
    type IconCategory,
    searchIcons
} from '@/config/iconLibrary';

const props = defineProps<{
    selectedGlyph?: string | null;
    searchPlaceholder?: string;
    glyphFilter?: (cls: string) => boolean;
    enableUpload?: boolean;
    enableUrl?: boolean;
    onUpload?: (file: File) => Promise<string | null>;
}>();

const emit = defineEmits<{
    pickGlyph: [cls: string];
    pickUrl: [url: string];
}>();

type TabKey = 'library' | 'upload' | 'url';

const tabs = computed(() => {
    const out: Array<{value: TabKey; label: string; icon: string}> = [
        {value: 'library', label: 'Library', icon: 'fas fa-grip'}
    ];
    if (props.enableUpload)
        out.push({
            value: 'upload',
            label: 'Upload',
            icon: 'fas fa-arrow-up-from-bracket'
        });
    if (props.enableUrl)
        out.push({value: 'url', label: 'URL', icon: 'fas fa-link'});
    return out;
});
const hasTabs = computed(() => tabs.value.length > 1);

const tab = ref<TabKey>('library');
const query = ref('');
const cat = ref<IconCategory | null>(null);
const urlInput = ref('');
const uploadedUrl = ref<string | null>(null);

const searchPlaceholder = computed(
    () => props.searchPlaceholder ?? `Search ${ICON_LIBRARY.length} icons…`
);

const filteredIcons = computed(() => {
    let base = query.value ? searchIcons(query.value) : ICON_LIBRARY;
    if (cat.value !== null) base = base.filter((e) => e.category === cat.value);
    if (props.glyphFilter) base = base.filter((e) => props.glyphFilter!(e.cls));
    return base;
});

function isValidUrl(value: string): boolean {
    const v = value.trim();
    if (!v) return false;
    try {
        const p = new URL(v);
        return p.protocol === 'http:' || p.protocol === 'https:';
    } catch {
        return false;
    }
}

function onPickUrl(): void {
    if (!isValidUrl(urlInput.value)) return;
    emit('pickUrl', urlInput.value.trim());
}

async function onPickFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || !props.onUpload) return;
    const url = await props.onUpload(file);
    if (url) {
        uploadedUrl.value = url;
        emit('pickUrl', url);
    }
}
</script>

<style scoped>
.ipp {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.ipp__tabs {
    display: flex;
    gap: var(--space-1);
    border-bottom: 1px solid var(--color-border-subtle);
}
.ipp__tab {
    padding: var(--space-1) var(--space-3);
    background: transparent;
    border: none;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    cursor: pointer;
    border-bottom: 2px solid transparent;
}
.ipp__tab--active {
    color: var(--color-text-primary);
    border-bottom-color: var(--color-primary);
}
.ipp__panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.ipp__search {
    padding: var(--space-2) var(--space-3);
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    border-radius: var(--input-radius);
    color: var(--color-text-primary);
    font-size: var(--input-font-size);
}
.ipp__cats {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
}
.ipp__chip {
    padding: var(--space-px) var(--space-2);
    border-radius: var(--radius-2xl);
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    cursor: pointer;
}
.ipp__chip--active {
    background: rgba(var(--color-primary-rgb), 0.15);
    color: var(--color-primary-text);
    border-color: rgba(var(--color-primary-rgb), 0.4);
}
.ipp__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(2.75rem, 1fr));
    gap: var(--space-1);
    max-height: 24rem;
    overflow-y: auto;
    padding: var(--space-1);
    background: var(--color-surface-1);
    border-radius: var(--radius-md);
}
.ipp__icon {
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-surface-2);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font-size: var(--type-subheading);
    cursor: pointer;
}
.ipp__icon:hover {
    border-color: var(--color-border-strong);
}
.ipp__icon--selected {
    border-color: var(--color-primary);
    background: rgba(var(--color-primary-rgb), 0.15);
}
.ipp__empty {
    grid-column: 1 / -1;
    padding: var(--space-3);
    text-align: center;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.ipp__hint {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    margin: 0;
}
.ipp__url-btn {
    align-self: flex-start;
    padding: var(--space-1) var(--space-3);
    background: var(--color-primary);
    color: var(--color-text-on-primary, white);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
}
.ipp__url-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.ipp__preview {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.ipp__preview img {
    width: 48px;
    height: 48px;
    object-fit: contain;
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
}
</style>

<template>
    <Modal :visible="visible" wide @close="onClose">
        <template #title>
            <div class="apm__hero">
                <div class="apm__hero-copy">
                    <span class="apm__hero-eyebrow">{{ heroEyebrow }}</span>
                    <h3 class="apm__hero-title">{{ heroTitle }}</h3>
                </div>
            </div>
        </template>

        <div class="apm">
            <nav class="apm__tabs" role="tablist" aria-label="Asset picker tabs">
                <button
                    v-for="tab in TABS"
                    :key="tab.id"
                    role="tab"
                    type="button"
                    class="apm__tab"
                    :class="{'apm__tab--active': activeTab === tab.id}"
                    :aria-selected="activeTab === tab.id ? 'true' : 'false'"
                    @click="activeTab = tab.id"
                >
                    <i :class="tab.icon" aria-hidden="true" /> {{ tab.label }}
                </button>
            </nav>

            <nav
                v-if="activeTab === 'picture'"
                class="apm__subtabs"
                role="tablist"
                aria-label="Picture source"
            >
                <button
                    type="button"
                    class="apm__subtab"
                    :class="{'apm__subtab--active': pictureMode === 'library'}"
                    @click="pictureMode = 'library'"
                >
                    <i class="fas fa-images" aria-hidden="true" /> Library
                </button>
                <button
                    type="button"
                    class="apm__subtab"
                    :class="{'apm__subtab--active': pictureMode === 'devices'}"
                    @click="pictureMode = 'devices'"
                >
                    <i class="fas fa-microchip" aria-hidden="true" /> Devices
                </button>
                <button
                    type="button"
                    class="apm__subtab"
                    :class="{'apm__subtab--active': pictureMode === 'upload'}"
                    @click="pictureMode = 'upload'"
                >
                    <i class="fas fa-cloud-arrow-up" aria-hidden="true" /> Upload
                </button>
            </nav>

            <section
                v-if="activeTab === 'picture' && pictureMode === 'library'"
                class="apm__lane"
            >
                <div class="apm__library-head">
                    <div
                        class="search-pill apm__library-search"
                        :class="{
                            'search-pill__input--filtered':
                                activeContext !== 'all'
                        }"
                    >
                        <i class="fas fa-search search-pill__icon" />
                        <input
                            v-model="searchTerm"
                            type="text"
                            class="search-pill__input"
                            placeholder="Filter by label…"
                            autocomplete="off"
                            aria-label="Filter library by label"
                        />
                        <button
                            v-if="searchTerm"
                            type="button"
                            class="search-pill__clear"
                            aria-label="Clear search"
                            @click="searchTerm = ''"
                        >
                            <i class="fas fa-xmark" />
                        </button>
                        <button
                            type="button"
                            class="search-pill__filter"
                            :class="{
                                'search-pill__filter--active':
                                    activeContext !== 'all'
                            }"
                            aria-label="Filter by origin"
                            @click="originMenuOpen = !originMenuOpen"
                        >
                            <i class="fas fa-filter" />
                        </button>
                        <button
                            v-if="originMenuOpen"
                            type="button"
                            class="apm__origin-backdrop"
                            aria-hidden="true"
                            tabindex="-1"
                            @click="originMenuOpen = false"
                        />
                        <ul v-if="originMenuOpen" class="apm__origin-menu">
                            <li v-for="chip in contextChips" :key="chip.id">
                                <button
                                    type="button"
                                    class="apm__origin-opt"
                                    :class="{
                                        'apm__origin-opt--active':
                                            activeContext === chip.id
                                    }"
                                    @click="selectOrigin(chip.id)"
                                >
                                    <i
                                        class="fas fa-check apm__origin-check"
                                        :class="{
                                            'apm__origin-check--on':
                                                activeContext === chip.id
                                        }"
                                    />
                                    {{ chip.label }}
                                </button>
                            </li>
                        </ul>
                    </div>
                    <Button
                        type="blue-hollow"
                        size="sm"
                        :loading="loading"
                        @click="loadLibrary"
                    >
                        Refresh
                    </Button>
                </div>
                <div v-if="loadError" class="apm__state apm__state--error">
                    {{ loadError }}
                </div>
                <div
                    v-else-if="loading && !assets.length"
                    class="apm__state"
                >
                    <Spinner size="sm" /> <span>Loading library…</span>
                </div>
                <div
                    v-else-if="!filteredAssets.length"
                    class="apm__state apm__state--empty"
                >
                    <i class="fas fa-image" aria-hidden="true" />
                    <span>{{
                        assets.length
                            ? 'No assets match the filter.'
                            : 'No assets yet — upload your first image.'
                    }}</span>
                </div>
                <ul v-else class="apm__grid">
                    <li
                        v-for="asset in filteredAssets"
                        :key="asset.id"
                        class="apm__tile"
                        :class="{'apm__tile--active': asset.id === selectedAssetId}"
                        :data-asset-id="asset.id"
                    >
                        <button
                            type="button"
                            class="apm__tile-button"
                            @click="onSelect(asset)"
                        >
                            <img
                                :src="asset.url"
                                :alt="asset.label ?? 'Asset'"
                                loading="lazy"
                            />
                        </button>
                        <div class="apm__tile-meta">
                            <span class="apm__tile-label">
                                {{ asset.label ?? '(unlabeled)' }}
                            </span>
                            <button
                                type="button"
                                class="apm__tile-action"
                                title="Rename"
                                @click="onRename(asset)"
                            >
                                <i class="fas fa-pencil" aria-hidden="true" />
                            </button>
                            <button
                                type="button"
                                class="apm__tile-action apm__tile-action--danger"
                                title="Delete"
                                @click="onDelete(asset)"
                            >
                                <i class="fas fa-trash" aria-hidden="true" />
                            </button>
                        </div>
                    </li>
                </ul>
            </section>

            <section
                v-else-if="activeTab === 'picture' && pictureMode === 'devices'"
                class="apm__lane"
            >
                <div class="apm__library-head">
                    <div class="search-pill apm__library-search">
                        <i class="fas fa-search search-pill__icon" />
                        <input
                            v-model="devicePictureSearch"
                            type="text"
                            class="search-pill__input"
                            placeholder="Filter device pictures…"
                            autocomplete="off"
                            aria-label="Filter device pictures"
                        />
                        <button
                            v-if="devicePictureSearch"
                            type="button"
                            class="search-pill__clear"
                            aria-label="Clear search"
                            @click="devicePictureSearch = ''"
                        >
                            <i class="fas fa-xmark" />
                        </button>
                    </div>
                </div>
                <ul class="apm__grid">
                    <li
                        v-for="picture in filteredDevicePictures"
                        :key="picture.model"
                        class="apm__tile"
                        :class="{'apm__tile--active': picture.model === selectedImageModel}"
                        :data-device-model="picture.model"
                    >
                        <button
                            type="button"
                            class="apm__tile-button"
                            @click="onSelectDevicePicture(picture)"
                        >
                            <img
                                :src="picture.url"
                                :alt="picture.label"
                                loading="lazy"
                            />
                        </button>
                        <div class="apm__tile-meta">
                            <span class="apm__tile-label">
                                {{ picture.label }}
                            </span>
                        </div>
                    </li>
                </ul>
            </section>

            <section v-else-if="activeTab === 'icon'" class="apm__lane">
                <div class="apm__icon-head">
                    <span class="apm__icon-preview" aria-hidden="true">
                        <i
                            :class="[
                                'apm__icon-preview-glyph',
                                pickedIcon || 'mdi mdi-shape-outline'
                            ]"
                            :style="iconPreviewStyle"
                        />
                    </span>
                    <div v-if="showAccent" class="apm__accent">
                        <span class="apm__accent-label">Color</span>
                        <AccentTokenPicker v-model="pickedAccent" />
                    </div>
                </div>
                <MdiIconPicker :selected="pickedIcon" @pick="onPickIcon" />
            </section>

            <section
                v-else-if="activeTab === 'picture' && pictureMode === 'upload'"
                class="apm__lane"
            >
                <FormField label="Image file">
                    <input
                        ref="fileInputEl"
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        :disabled="uploading"
                        @change="onFileSelected"
                    />
                </FormField>
                <div v-if="uploadPreview" class="apm__preview">
                    <img
                        :src="uploadPreview"
                        alt="Upload preview"
                    />
                </div>
                <FormField label="Label (optional)">
                    <Input
                        v-model="uploadLabel"
                        placeholder="Living-room thermostat"
                        :disabled="uploading"
                    />
                </FormField>
                <div v-if="uploadError" class="apm__state apm__state--error">
                    {{ uploadError }}
                </div>
            </section>
        </div>

        <template #footer>
            <div class="apm__footer">
                <Button
                    v-if="hasDecoration"
                    type="red"
                    size="sm"
                    @click="onClear"
                >
                    Remove
                </Button>
                <span class="apm__footer-spacer" />
                <Button type="blue-hollow" size="sm" @click="onClose">Cancel</Button>
                <Button
                    v-if="activeTab === 'icon'"
                    type="blue"
                    size="sm"
                    :disabled="!pickedIcon"
                    @click="onUseIcon"
                >
                    Apply
                </Button>
                <Button
                    v-else-if="activeTab === 'picture' && pictureMode === 'upload'"
                    type="blue"
                    size="sm"
                    :loading="uploading"
                    :disabled="!uploadFile || uploading"
                    @click="onUpload"
                >
                    Upload and use
                </Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import {
    AssetUploadError,
    type AssetUploadTicket,
    deleteAsset,
    listAssets,
    renameAsset,
    uploadAsset,
    type VisualAsset
} from '@/api/assetRpc';
import AccentTokenPicker from '@/components/core/AccentTokenPicker.vue';
import Button from '@/components/core/Button.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import MdiIconPicker from '@/components/core/MdiIconPicker.vue';
import Spinner from '@/components/core/Spinner.vue';
import {BUNDLED_DEVICE_IMAGES} from '@/helpers/deviceImageManifest';
import Modal from './Modal.vue';

type TabId = 'picture' | 'icon';
type PictureMode = 'library' | 'devices' | 'upload';

interface DevicePicture {
    model: string;
    label: string;
    url: string;
}

const props = withDefaults(
    defineProps<{
        visible: boolean;
        initialSelectedAssetId?: string | null;
        initialSelectedImageModel?: string | null;
        initialSelectedIcon?: string | null;
        initialSelectedAccent?: string | null;
        defaultContext?: string;
        // Devices use icons without a color tint.
        showAccent?: boolean;
        uploadTicket?: () => Promise<AssetUploadTicket | null>;
    }>(),
    {showAccent: true}
);

// A decoration is a picture or an icon; an accent colors the icon.
const heroTitle = 'Choose a picture or icon';
const heroEyebrow = 'Decoration';

const TABS: Array<{id: TabId; label: string; icon: string}> = [
    {id: 'picture', label: 'Picture', icon: 'fas fa-image'},
    {id: 'icon', label: 'Icon', icon: 'fas fa-icons'}
];

const hasDecoration = computed(
    () =>
        !!(
            props.initialSelectedAssetId ||
            props.initialSelectedImageModel ||
            props.initialSelectedIcon
        )
);

const emit = defineEmits<{
    close: [];
    'select-asset': [asset: VisualAsset];
    'select-device-picture': [picture: DevicePicture];
    'select-icon': [decoration: {icon: string; accent: string | null}];
    clear: [];
}>();

function onPickIcon(iconClass: string): void {
    pickedIcon.value = iconClass;
}

function onUseIcon(): void {
    if (!pickedIcon.value) return;
    emit('select-icon', {icon: pickedIcon.value, accent: pickedAccent.value});
    emit('close');
}

const CONTEXT_LABELS: Record<string, string> = {
    device: 'Devices',
    group: 'Groups',
    component: 'Components',
    general: 'General'
};

const activeTab = ref<TabId>('picture');
const pictureMode = ref<PictureMode>('library');
const pickedIcon = ref<string | null>(null);
const pickedAccent = ref<string | null>(null);

const iconPreviewStyle = computed(() =>
    props.showAccent && pickedAccent.value
        ? {color: `rgb(var(--accent-${pickedAccent.value}))`}
        : undefined
);

const assets = ref<VisualAsset[]>([]);
const selectedAssetId = ref<string | null>(null);
const selectedImageModel = ref<string | null>(null);
const searchTerm = ref('');
const devicePictureSearch = ref('');
const loading = ref(false);
const loadError = ref<string | null>(null);
const activeContext = ref<string>('all');
const originMenuOpen = ref(false);

const uploadFile = ref<File | null>(null);
const uploadLabel = ref('');
const uploadPreview = ref<string | null>(null);
const uploadError = ref<string | null>(null);
const uploading = ref(false);
const fileInputEl = ref<HTMLInputElement | null>(null);

// Stale-load guard: rapid reopens or background re-renders bump this
// token so an in-flight List response only wins if it's still current.
let loadToken = 0;

// Context chips: 'all' + every distinct context in the org's library +
// the surface's default (so a brand-new context still gets a chip).
const contextChips = computed<Array<{id: string; label: string}>>(() => {
    const ids = new Set<string>();
    if (props.defaultContext) ids.add(props.defaultContext);
    for (const a of assets.value) ids.add(a.context);
    const list = [{id: 'all', label: 'All'}];
    for (const id of ids) {
        list.push({id, label: CONTEXT_LABELS[id] ?? id});
    }
    return list;
});

function selectOrigin(id: string): void {
    activeContext.value = id;
    originMenuOpen.value = false;
}

const filteredAssets = computed(() => {
    const q = searchTerm.value.trim().toLowerCase();
    return assets.value.filter((a) => {
        if (activeContext.value !== 'all' && a.context !== activeContext.value) {
            return false;
        }
        if (q && !(a.label ?? '').toLowerCase().includes(q)) return false;
        return true;
    });
});

const DEVICE_PICTURE_SKIP = new Set(['logo_white_S']);

const devicePictures = computed<DevicePicture[]>(() =>
    [...BUNDLED_DEVICE_IMAGES]
        .filter((model) => !DEVICE_PICTURE_SKIP.has(model))
        .sort((a, b) =>
            labelForDevicePicture(a).localeCompare(labelForDevicePicture(b))
        )
        .map((model) => ({
            model,
            label: labelForDevicePicture(model),
            url: `/images/devices/${model}.png`
        }))
);

const filteredDevicePictures = computed(() => {
    const q = devicePictureSearch.value.trim().toLowerCase();
    if (!q) return devicePictures.value;
    return devicePictures.value.filter(
        (picture) =>
            picture.label.toLowerCase().includes(q) ||
            picture.model.toLowerCase().includes(q)
    );
});

function labelForDevicePicture(model: string): string {
    return model
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

async function loadLibrary(): Promise<void> {
    const myToken = ++loadToken;
    loading.value = true;
    loadError.value = null;
    try {
        const result = await listAssets({limit: 200});
        if (myToken !== loadToken) return;
        assets.value = result.items;
    } catch (err) {
        if (myToken !== loadToken) return;
        loadError.value = err instanceof Error ? err.message : String(err);
    } finally {
        if (myToken === loadToken) loading.value = false;
    }
}

function clearUploadPreview(): void {
    if (uploadPreview.value) URL.revokeObjectURL(uploadPreview.value);
    uploadPreview.value = null;
}

function onFileSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0] ?? null;
    clearUploadPreview();
    uploadFile.value = file;
    uploadError.value = null;
    if (file) uploadPreview.value = URL.createObjectURL(file);
}

async function onUpload(): Promise<void> {
    if (!uploadFile.value) return;
    uploading.value = true;
    uploadError.value = null;
    try {
        const asset = await uploadAsset(
            uploadFile.value,
            uploadLabel.value.trim() || null,
            props.defaultContext,
            props.uploadTicket ? await props.uploadTicket() : null
        );
        clearUploadPreview();
        assets.value = [asset, ...assets.value.filter((a) => a.id !== asset.id)];
        emit('select-asset', asset);
        emit('close');
    } catch (err) {
        if (err instanceof AssetUploadError) {
            uploadError.value =
                err.status === 413
                    ? 'File is too large.'
                    : err.status === 400
                      ? `Bad image: ${err.detail}`
                      : err.detail;
        } else {
            uploadError.value =
                err instanceof Error ? err.message : String(err);
        }
    } finally {
        uploading.value = false;
    }
}

function onSelect(asset: VisualAsset): void {
    selectedAssetId.value = asset.id;
    selectedImageModel.value = null;
    emit('select-asset', asset);
    emit('close');
}

function onSelectDevicePicture(picture: DevicePicture): void {
    selectedImageModel.value = picture.model;
    selectedAssetId.value = null;
    emit('select-device-picture', picture);
    emit('close');
}

async function onRename(asset: VisualAsset): Promise<void> {
    const label = window.prompt('New label:', asset.label ?? '');
    if (label === null) return;
    try {
        const updated = await renameAsset(
            asset.id,
            label.trim() === '' ? null : label.trim()
        );
        assets.value = assets.value.map((a) =>
            a.id === asset.id ? updated : a
        );
    } catch (err) {
        loadError.value = err instanceof Error ? err.message : String(err);
    }
}

async function onDelete(asset: VisualAsset): Promise<void> {
    if (!window.confirm(`Delete "${asset.label ?? asset.id}"?`)) return;
    try {
        await deleteAsset(asset.id);
        assets.value = assets.value.filter((a) => a.id !== asset.id);
    } catch (err) {
        const code = (err as {code?: number}).code;
        loadError.value =
            code === 3500
                ? 'Asset is still in use by another device or group.'
                : err instanceof Error
                  ? err.message
                  : String(err);
    }
}

function onClear(): void {
    emit('clear');
    emit('close');
}

function onClose(): void {
    emit('close');
}

function resetUploadForm(): void {
    uploadFile.value = null;
    uploadLabel.value = '';
    uploadError.value = null;
    clearUploadPreview();
    if (fileInputEl.value) fileInputEl.value.value = '';
}

watch(
    () => props.visible,
    (open) => {
        if (open) {
            activeTab.value = props.initialSelectedIcon ? 'icon' : 'picture';
            pictureMode.value = 'library';
            pickedIcon.value = props.initialSelectedIcon ?? null;
            pickedAccent.value = props.initialSelectedAccent ?? null;
            selectedAssetId.value = props.initialSelectedAssetId ?? null;
            selectedImageModel.value = props.initialSelectedImageModel ?? null;
            devicePictureSearch.value = '';
            // Default to the surface's own context so the user lands on
            // "recommended for here"; they can switch to 'all'.
            activeContext.value = props.defaultContext ?? 'all';
            resetUploadForm();
            loadLibrary();
        } else {
            // Close-while-uploading would leak the Blob URL without this.
            clearUploadPreview();
            loadToken++;
        }
    }
);

onBeforeUnmount(clearUploadPreview);
</script>

<style scoped>
.apm {
    display: grid;
    gap: var(--gap-lg);
    min-height: 360px;
}
.apm__hero {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
}
.apm__hero-copy {
    display: grid;
    gap: 0;
}
.apm__hero-eyebrow {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}
.apm__hero-title {
    margin: 0;
    font-size: var(--type-subheading);
    color: var(--color-text-primary);
    font-weight: var(--font-semibold);
    line-height: var(--leading-tight);
}
.apm__tabs {
    display: flex;
    gap: var(--gap-sm);
    padding: var(--space-1);
    background: var(--glass-2-bg);
    -webkit-backdrop-filter: var(--glass-2-filter);
    backdrop-filter: var(--glass-2-filter);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-full);
    width: fit-content;
}
.apm__tab {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    padding: var(--space-2) var(--space-4);
    background: transparent;
    border: 0;
    border-radius: var(--radius-full);
    color: var(--color-text-secondary);
    font-weight: var(--font-medium);
    cursor: pointer;
}
.apm__tab--active {
    background: var(--color-primary);
    color: var(--color-text-inverse);
    box-shadow: var(--shadow-brand-glow);
}
.apm__subtabs {
    display: flex;
    gap: var(--gap-xs);
    margin-top: var(--gap-sm);
    width: fit-content;
}
.apm__subtab {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    padding: var(--space-1-5) var(--space-3);
    background: transparent;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-full);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    cursor: pointer;
}
.apm__subtab--active {
    border-color: var(--color-primary);
    color: var(--color-primary);
    background: rgba(var(--color-primary-rgb), 0.1);
}
.apm__lane {
    display: grid;
    gap: var(--gap-md);
    /* Stable floor so switching tabs doesn't resize the modal. */
    min-height: 360px;
    align-content: start;
}
.apm__icon-head {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
    padding: var(--gap-sm);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
}
.apm__icon-preview {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--space-12);
    height: var(--space-12);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-subtle);
}
.apm__icon-preview-glyph {
    font-size: var(--icon-size-lg);
    color: var(--color-text-primary);
}
.apm__accent {
    display: grid;
    gap: var(--gap-xs);
    flex: 1;
}
.apm__accent-label {
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
}
.apm__library-head {
    display: flex;
    gap: var(--gap-sm);
    align-items: center;
}
.apm__library-head > :first-child {
    flex: 1;
}
.apm__origin-backdrop {
    position: fixed;
    inset: 0;
    z-index: 15;
    background: transparent;
    border: 0;
    cursor: default;
}
.apm__origin-menu {
    position: absolute;
    top: calc(100% + var(--space-1));
    right: 0;
    z-index: 20;
    min-width: 168px;
    margin: 0;
    padding: var(--space-1);
    list-style: none;
    display: grid;
    gap: var(--space-0-5);
    background: var(--glass-4-bg);
    -webkit-backdrop-filter: var(--glass-4-filter);
    backdrop-filter: var(--glass-4-filter);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--glass-shadow);
}
.apm__origin-opt {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1-5) var(--space-2);
    background: transparent;
    border: 0;
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-family: inherit;
    font-size: var(--type-caption);
    text-align: left;
    cursor: pointer;
}
.apm__origin-opt:hover {
    background: var(--glass-hover);
    color: var(--color-text-primary);
}
.apm__origin-opt--active {
    color: var(--color-primary);
}
.apm__origin-check {
    font-size: var(--type-caption);
    visibility: hidden;
}
.apm__origin-check--on {
    visibility: visible;
}
.apm__state {
    display: grid;
    place-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-xl);
    text-align: center;
    color: var(--color-text-secondary);
    background: var(--color-surface-2);
    border: 1px dashed var(--color-border-subtle);
    border-radius: var(--radius-lg);
    min-height: 180px;
}
.apm__state--empty i {
    color: var(--brand-light);
    font-size: var(--icon-size-xl);
}
.apm__state--error {
    color: var(--color-warning-text);
    background: var(--color-warning-subtle);
    border-style: solid;
    min-height: 0;
    padding: var(--gap-md);
}
.apm__grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: var(--gap-md);
}
.apm__tile {
    display: grid;
    gap: var(--gap-xs);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
}
.apm__tile--active {
    border-color: var(--brand-blue);
    box-shadow: var(--shadow-brand-glow);
}
.apm__tile-button {
    display: block;
    width: 100%;
    aspect-ratio: 1 / 1;
    background: var(--color-surface-2);
    border: 0;
    padding: 0;
    cursor: pointer;
}
.apm__tile-button img {
    width: 100%;
    height: 100%;
    object-fit: contain;
}
.apm__tile-meta {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    padding: var(--space-1-5) var(--space-2);
    font-size: var(--type-caption);
}
.apm__tile-label {
    flex: 1;
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.apm__tile-action {
    background: transparent;
    border: 0;
    color: var(--color-text-tertiary);
    cursor: pointer;
    padding: var(--space-0-5) var(--space-1);
    border-radius: var(--radius-sm);
}
.apm__tile-action:hover {
    color: var(--color-text-primary);
    background: var(--color-surface-2);
}
.apm__tile-action--danger:hover {
    color: var(--color-warning-text);
}
.apm__preview {
    max-width: 200px;
    aspect-ratio: 1 / 1;
    background: var(--color-surface-2);
    border-radius: var(--radius-lg);
    overflow: hidden;
}
.apm__preview img {
    width: 100%;
    height: 100%;
    object-fit: contain;
}
.apm__footer {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
}
.apm__footer-spacer {
    flex: 1;
}
</style>

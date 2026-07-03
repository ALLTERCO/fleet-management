<template>
    <div class="bg-panel">
        <div class="bg-panel__head">
            <div class="bg-panel__head-left">
                <span class="bg-panel__title">App Settings</span>
                <span v-if="version" class="bg-panel__version">v{{ version }}</span>
            </div>
            <label v-if="canManageBackgroundAssets" for="file-upload" class="bg-panel__upload"
                :class="{'bg-panel__upload--busy': uploadingBackground}">
                <i class="fas" :class="uploadingBackground ? 'fa-spinner fa-spin' : 'fa-upload'"></i>
                <span>{{ uploadingBackground ? 'Uploading…' : 'Upload' }}</span>
            </label>
            <input id="file-upload" class="hidden-input" type="file" capture accept=".jpg, .jpeg, .png"
                :disabled="uploadingBackground"
                aria-label="Upload app picture" @change="handleFileUpload" />
        </div>
        <div class="bg-panel__body">
            <div>
                <p class="bg-panel__section-label">Backgrounds</p>
                <div class="as-thumb-grid">
                    <div v-for="(thumb, index) in thumbnails" :key="index"
                        class="as-thumb" :class="{'as-thumb--active': isSelectedAsBackground(index)}"
                        :style="{ backgroundImage: `url(${thumb})` }"
                        @click="handleBackgroundChange(index, thumb)">
                        <span v-if="isSelectedAsBackground(index)" class="as-check"><i class="fas fa-check" /></span>
                        <button v-if="canManageBackgroundAssets" class="as-delete" title="Delete background" aria-label="Delete background" @click.stop="deleteBackground(index)"><i class="fas fa-trash" /></button>
                    </div>
                </div>
            </div>
            <div class="as-section-gap">
                <p class="bg-panel__section-label">Solid Colors</p>
                <div class="as-thumb-grid">
                    <div v-for="color in solidColors" :key="color"
                        class="as-thumb" :class="{'as-thumb--active': selectedColor === color}"
                        :style="{ backgroundColor: color }"
                        @click="handleBackgroundChange(null, null, color)">
                        <span v-if="selectedColor === color" class="as-check"><i class="fas fa-check" /></span>
                    </div>
                </div>
            </div>
        <ConfirmationModal footer ref='modalRefDelete'>
            <template #title>
                <h3>You are about to delete a background! <br> Proceed?</h3>
            </template>
            <template #footer>
            </template>
        </ConfirmationModal>
        </div>
    </div>

    <div class="ui-panel">
        <div class="ui-panel__head">
            <span class="ui-panel__title">Interface</span>
        </div>
        <div class="ui-panel__body">
            <div class="ui-panel__row">
                <div class="ui-panel__row-label">
                    <i class="fas fa-columns" />
                    <span>Sidebar</span>
                </div>
                <div class="as-options">
                    <button v-for="opt in sidebarOptions" :key="opt.value"
                        class="as-opt-btn" :class="{'as-opt-btn--active': sidebarMode === opt.value}"
                        @click="sidebarMode = opt.value">{{ opt.label }}</button>
                </div>
            </div>
            <p class="ui-panel__hint">
                {{ sidebarModeHint }}
            </p>
        </div>
    </div>
</template>

<script setup lang="ts">
import {storeToRefs} from 'pinia';
import {computed, onMounted, ref, watch} from 'vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import {FLEET_MANAGER_HTTP} from '@/constants';
import apiClient from '@/helpers/axios';
import {useRpcPermissions} from '@/helpers/rpcPermissions';
import {useSidebarState} from '@/helpers/ui';
import {useGeneralStore} from '@/stores/general';
import {useToastStore} from '@/stores/toast';
import {createUploadTicket} from '@/tools/uploadTickets';
import {sendRPC} from '@/tools/websocket';

const rpc = useRpcPermissions();
const canManageBackgroundAssets = computed(
    () =>
        rpc.canCall('Media.Background.CreateUploadTicket') &&
        rpc.canCall('Media.Background.Delete')
);

const {sidebarMode, sidebarExpanded, toggleSidebar} = useSidebarState();

const sidebarOptions = [
    {value: 'collapsed' as const, label: 'Collapsed'},
    {value: 'hidden' as const, label: 'Hidden'}
];

const sidebarModeHint = computed(() => {
    if (sidebarMode.value === 'hidden') {
        return 'Sidebar completely hidden.';
    }
    return 'Icons only, hover shows name tooltip.';
});

defineProps<{
    version?: string;
}>();

const toast = useToastStore();
const generalStore = useGeneralStore();
const {setBackgroundImg, setBackgroundColor, solidColors} = generalStore;
const {background} = storeToRefs(generalStore);

// State variables
const thumbnails = ref<string[]>([]);
const displays = ref<string[]>([]);
const originals = ref<string[]>([]);
const selectedIndex = ref<number | null>(null);
const selectedColor = ref<string | null>(background.value);
const selectedBackground = ref<string | null>(background.value);
const fileProfile = ref<File | null>(null);
const uploadingBackground = ref(false);
let localPreviewUrl: string | null = null;
const modalRefDelete = ref<InstanceType<typeof ConfirmationModal>>();

const basePath = `${FLEET_MANAGER_HTTP}/uploads/backgrounds`;

function stripQuery(value: string): string {
    const [pathOnly] = value.split('?');
    return pathOnly;
}

function assetPath(value: string): string {
    try {
        return stripQuery(new URL(value, FLEET_MANAGER_HTTP).pathname);
    } catch {
        return stripQuery(value);
    }
}

function resolveBackgroundUrl(value: string): string {
    if (value.startsWith('/')) {
        return FLEET_MANAGER_HTTP + value;
    }
    // Legacy absolute URL — re-resolve with current host
    if (value.startsWith('http')) {
        try {
            const path = new URL(value).pathname;
            return FLEET_MANAGER_HTTP + path;
        } catch {
            /* fall through */
        }
    }
    return stripQuery(value);
}

const loadImages = async () => {
    try {
        const response = await sendRPC<{
            thumbnails: string[];
            displays: string[];
            originals: string[];
        }>('FLEET_MANAGER', 'Media.Background.List', {});

        // displays[] is what the page paints (FHD-sized).
        thumbnails.value = response.thumbnails.map(
            (file: string) => `${basePath}/${file}`
        );
        displays.value = (response.displays ?? []).map(
            (file: string) => `${basePath}/${file}`
        );
        originals.value = response.originals.map(
            (file: string) => `${basePath}/${file}`
        );

        // Sync local UI state with stored background (no save, no toast)
        if (!background.value || background.value === 'undefined') {
            selectedBackground.value = originals.value[0] ?? null;
            selectedIndex.value = originals.value.length > 0 ? 0 : null;
        } else if (background.value.includes('#')) {
            selectedColor.value = background.value;
            selectedIndex.value = null;
        } else if (background.value.includes('uploads')) {
            // Resolve relative/absolute stored path to full URL for display
            const resolvedUrl = resolveBackgroundUrl(background.value);
            const index = originals.value.findIndex(
                (url) => assetPath(url) === assetPath(resolvedUrl)
            );
            selectedBackground.value =
                index >= 0 ? originals.value[index] : resolvedUrl;
            selectedIndex.value = index;
        }
    } catch (err) {
        console.error('Failed to load images', err);
    }
};
watch(
    [() => background.value, () => originals.value],
    ([bg, orig]) => {
        if (orig && orig.length > 0) {
            if (!bg || bg === 'undefined') {
                selectedBackground.value = orig[0];
                selectedIndex.value = 0;
            } else if (bg.includes('#')) {
                selectedColor.value = bg;
                selectedIndex.value = null;
            } else if (bg.includes('uploads')) {
                const resolvedUrl = resolveBackgroundUrl(bg);
                const index = orig.findIndex(
                    (url) => assetPath(url) === assetPath(resolvedUrl)
                );
                selectedBackground.value =
                    index >= 0 ? orig[index] : resolvedUrl;
                selectedIndex.value = index;
            }
        }
    },
    {immediate: true}
);

const isSelectedAsBackground = computed(() => (index: number) => {
    return selectedIndex.value === index;
});

const selectBackground = async (index: number, thumb: string) => {
    selectedIndex.value = index;
    const originalUrl = originals.value[index] ?? thumb.replace('_thumb', '');
    // displays[] is FHD-sized; falls back to original if list is stale.
    const paintUrl = displays.value[index] ?? originalUrl;
    selectedBackground.value = originalUrl;
    selectedColor.value = null;
    const relative = assetPath(paintUrl);
    await setBackgroundImg(relative, paintUrl);
    await loadImages();
    toast.success('Background changed successfully');
};

const selectBackgroundColor = async (color: string) => {
    selectedColor.value = color;
    selectedBackground.value = null;
    selectedIndex.value = null;
    await setBackgroundColor(selectedColor.value);
    await loadImages();
    toast.success('Background changed successfully');
};

const handleFileUpload = async ($event: Event) => {
    if (!canManageBackgroundAssets.value) return;
    const input = $event.target as HTMLInputElement;
    if (input?.files) {
        const originalFile = input.files[0];
        const fileExtension = originalFile.name.split('.').pop();
        const newFileName = `app_bg_${originals.value.length}.${fileExtension}`;
        const renamedFile = new File([originalFile], newFileName, {
            type: originalFile.type
        });
        fileProfile.value = renamedFile;
        showLocalBackgroundPreview(renamedFile);
        uploadingBackground.value = true;

        const formData = new FormData();
        formData.append('image', renamedFile);

        try {
            const ticket = await createUploadTicket(
                'Media.Background.CreateUploadTicket'
            );
            formData.append('ticket', ticket);
            const response = await apiClient.post(
                '/media/uploadBackground',
                formData,
                {
                    headers: {
                        'Content-Type': 'multipart/form-data'
                    }
                }
            );
            if (response.data.success) {
                await loadImages();
            }
        } catch (err) {
            console.error('Failed to upload image', err);
        } finally {
            revokeLocalBackgroundPreview();
            uploadingBackground.value = false;
            input.value = '';
        }
    } else {
        toast.error('No file selected');
    }
};

function showLocalBackgroundPreview(file: File): void {
    revokeLocalBackgroundPreview();
    localPreviewUrl = URL.createObjectURL(file);
    setBackgroundImg(localPreviewUrl, localPreviewUrl);
}

function revokeLocalBackgroundPreview(): void {
    if (!localPreviewUrl) return;
    URL.revokeObjectURL(localPreviewUrl);
    localPreviewUrl = null;
}

function deleteBackground(image: number) {
    if (!canManageBackgroundAssets.value) return;
    if (modalRefDelete.value) {
        modalRefDelete.value.storeAction(async () => {
            const current = originals.value[image];
            const prefix = `${basePath}/`;
            const pathOnly = stripQuery(current);
            const fileName = pathOnly.startsWith(prefix)
                ? pathOnly.slice(prefix.length)
                : pathOnly.split('/').pop();
            sendRPC('FLEET_MANAGER', 'Media.Background.Delete', {fileName})
                .then(() => loadImages())
                .catch((err) => console.error('Failed to delete image', err));
        });
    }
}

// Background change is non-destructive — clicking another thumbnail
// reverts. No confirm modal: each click applies immediately, the latest
// click wins, no captured-action race.
function handleBackgroundChange(
    index?: number | null,
    thumb?: string | null,
    color?: string | null
) {
    if (index !== null && index !== undefined && thumb) {
        void selectBackground(index, thumb);
    } else if (color) {
        void selectBackgroundColor(color);
    }
}

// Lifecycle hook to initialize thumbnails
onMounted(async () => {
    await loadImages();
});
</script>

<style scoped>
.bg-panel {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface-1);
    overflow: hidden;
}
.bg-panel__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--gap-xs) var(--gap-sm);
    min-height: var(--touch-target-min);
    border-bottom: 1px solid var(--color-border-default);
    background-color: var(--color-surface-2);
}
.bg-panel__head-left {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
}
.bg-panel__title {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-primary);
}
.bg-panel__version {
    font-size: var(--type-body);
    font-family: var(--font-mono);
    color: var(--color-text-disabled);
    padding: 1px var(--gap-xs);
    border-radius: var(--radius-full);
    background-color: var(--color-surface-3);
}
.bg-panel__upload {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    padding: var(--gap-xs) var(--gap-sm);
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-primary);
    background: linear-gradient(to left, var(--color-primary-active), var(--color-primary));
    border-radius: var(--btn-radius);
    cursor: pointer;
    transition: background var(--duration-fast);
}
.bg-panel__upload:hover {
    background: linear-gradient(to left, var(--color-primary-active), var(--color-primary-hover));
}
.bg-panel__body {
    padding: var(--gap-sm);
}
.bg-panel__section-label {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-tertiary);
    margin-bottom: var(--gap-sm);
}
.hidden-input { display: none; }

/* Thumbnail grid */
.as-thumb-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
    gap: var(--gap-sm);
}
.as-thumb {
    position: relative;
    width: 64px; height: 64px;
    border-radius: 50%;
    background-size: cover; background-position: center;
    border: 2px solid var(--color-border-default);
    cursor: pointer;
    transition: border-color var(--duration-fast);
}
.as-thumb--active { border-color: var(--color-primary); }
.as-thumb:hover { border-color: var(--color-text-tertiary); }
.as-check {
    position: absolute; top: var(--gap-xs); left: var(--gap-xs);
    width: var(--gap-md); height: var(--gap-md);
    border-radius: 50%;
    background: var(--color-primary);
    color: var(--primitive-neutral-50);
    display: flex; align-items: center; justify-content: center;
    font-size: var(--type-body);
}
.as-delete {
    position: absolute; top: calc(-1 * var(--space-1)); right: calc(-1 * var(--space-1));
    width: var(--gap-md); height: var(--gap-md);
    border-radius: 50%;
    background: var(--color-danger);
    color: var(--primitive-neutral-50);
    border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: var(--type-body);
    opacity: 0;
    transition: opacity var(--duration-fast);
}
.as-thumb:hover .as-delete { opacity: 1; }
.as-section-gap { margin-top: var(--gap-sm); }

/* Option buttons (sidebar mode) */
.as-options { display: flex; gap: var(--gap-xs); }
.as-opt-btn {
    padding: var(--gap-xs) var(--gap-sm);
    min-height: var(--touch-target-min);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: transparent;
    font-size: var(--type-body); font-weight: 600; font-family: inherit;
    color: var(--color-text-tertiary);
    cursor: pointer;
    transition: background var(--duration-fast), color var(--duration-fast), border-color var(--duration-fast);
}
.as-opt-btn:hover {
    color: var(--color-text-primary);
    background: var(--color-surface-3);
    border-color: var(--color-border-medium);
}
.as-opt-btn:active { transform: scale(var(--press-scale, 0.95)); }
.as-opt-btn:focus-visible { outline: 2px solid var(--color-border-focus); outline-offset: 2px; }
.as-opt-btn--active {
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
    color: var(--color-primary);
    border-color: var(--color-primary);
    font-weight: 700;
}

/* ========== Interface panel ========== */
.ui-panel {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface-1);
    overflow: hidden;
    margin-top: var(--gap-sm);
}
.ui-panel__head {
    display: flex;
    align-items: center;
    padding: var(--gap-xs) var(--gap-sm);
    min-height: var(--touch-target-min);
    border-bottom: 1px solid var(--color-border-default);
    background-color: var(--color-surface-2);
}
.ui-panel__title {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-primary);
}
.ui-panel__body {
    padding: var(--gap-sm);
}
.ui-panel__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--gap-xs) 0;
}
.ui-panel__row-label {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}
.ui-panel__hint {
    font-size: var(--type-body);
    color: var(--color-text-quaternary);
    margin-top: var(--gap-xs);
}

/* Toggle switch */
.ui-panel__toggle {
    position: relative;
    width: 2.5rem;
    height: 1.375rem;
    border-radius: var(--radius-full);
    border: none;
    background-color: var(--color-surface-3);
    cursor: pointer;
    transition: background-color var(--duration-fast);
    flex-shrink: 0;
}
.ui-panel__toggle--on {
    background-color: var(--color-primary);
}
.ui-panel__toggle-knob {
    position: absolute;
    top: var(--space-0-5);
    left: var(--space-0-5);
    width: 1.125rem;
    height: 1.125rem;
    border-radius: 50%;
    background-color: var(--primitive-neutral-50);
    transition: transform var(--duration-fast);
}
.ui-panel__toggle--on .ui-panel__toggle-knob {
    transform: translateX(1.125rem);
}
</style>

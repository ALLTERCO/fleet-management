<template>
    <BasicBlock darker>
        <div class="container">
            <h2 class="mb-4 capitalize text-2xl font-bold">Change App Background</h2>

            <!-- Upload Section -->
            <div class="mb-6">
                <p class="mb-4 text-sm font-medium">Custom Picture</p>
                <div class="flex items-center space-x-4">
                    <label for="file-upload"
                        class="flex items-center px-4 py-2 space-x-2 text-white bg-[var(--color-primary)] rounded cursor-pointer hover:bg-[var(--color-primary-hover)]">
                        <i class="fa-solid fa-upload"></i>
                        <span>Upload Picture</span>
                    </label>
                    <input id="file-upload" class="hidden-input" type="file" capture accept=".jpg, .jpeg, .png"
                        aria-label="Upload app picture" @change="handleFileUpload" />
                </div>
            </div>

            <!-- Gallery Section -->
            <BasicBlock title-padding>
                <p class="mb-4 text-sm font-medium">Gallery Backgrounds</p>
                <div class="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-12 gap-4">
                    <div v-for="(thumb, index) in thumbnails" :key="index">
                        <div class="relative w-20 h-20 bg-cover bg-center border-2 rounded-full group"
                            :style="{ backgroundImage: `url(${thumb})` }" :class="{
                                'border-[var(--color-primary)]': isSelectedAsBackground(index),
                                'border-[var(--color-border-default)]': !isSelectedAsBackground(index),
                            }" @click="handleBackgroundChange(index, thumb)">
                            <span v-if="isSelectedAsBackground(index)"
                                class="absolute top-1 left-1 text-white bg-[var(--color-primary)] rounded-full w-6 h-6 flex items-center justify-center">
                                <i class="fas fa-check text-xs"></i>
                            </span>
                            <button @click.stop="deleteBackground(index)"
                                class="absolute -top-1 -right-1 text-white bg-[var(--color-danger)] rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <i class="fas fa-remove text-xs"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </BasicBlock>
            <BasicBlock title-padding>
                <p class="mb-4 text-sm font-medium">Solid Colors</p>
                <div class="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-12 gap-4">
                    <div v-for="color in solidColors" :key="color">
                        <div class="relative w-20 h-20 bg-cover bg-center border-2 rounded-full group"
                            :style="{ backgroundColor: color }" :class="{
                                'border-[var(--color-primary)]': selectedColor === color,
                                'border-[var(--color-border-default)]': selectedColor !== color,
                            }" @click="handleBackgroundChange(null, null, color)">
                            <span v-if="selectedColor === color"
                                class="absolute top-1 left-1 text-white bg-[var(--color-primary)] rounded-full w-6 h-6 flex items-center justify-center">
                                <i class="fas fa-check text-xs"></i>
                            </span>
                        </div>
                    </div>
                </div>
            </BasicBlock>
        </div>
        <ConfirmationModal ref='modalRefChange'>
            <template #title>
                <h1>You are about to change the background! <br> Proceed?</h1>
            </template>
            <template #footer>
            </template>
        </ConfirmationModal>
        <ConfirmationModal footer ref='modalRefDelete'>
            <template #title>
                <h1>You are about to delete a background! <br> Proceed?</h1>
            </template>
            <template #footer>
            </template>
        </ConfirmationModal>
    </BasicBlock>
</template>

<script setup lang="ts">
import {storeToRefs} from 'pinia';
import {computed, onMounted, ref, watch} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import {FLEET_MANAGER_HTTP} from '@/constants';
import apiClient from '@/helpers/axios';
import {useGeneralStore} from '@/stores/general';
import {useToastStore} from '@/stores/toast';

const toast = useToastStore();
const generalStore = useGeneralStore();
const {setBackgroundImg, setBackgroundColor, solidColors} = generalStore;
const {background} = storeToRefs(generalStore);

// State variables
const thumbnails = ref<string[]>([]);
const originals = ref<string[]>([]);
const selectedIndex = ref<number | null>(null);
const selectedColor = ref<string | null>(background.value);
const selectedBackground = ref<string | null>(background.value);
const fileProfile = ref<File | null>(null);
const modalRefChange = ref<InstanceType<typeof ConfirmationModal>>();
const modalRefDelete = ref<InstanceType<typeof ConfirmationModal>>();

const basePath = FLEET_MANAGER_HTTP + '/uploads/backgrounds';

/** Resolve a stored background value (relative path or legacy absolute URL) to a full URL */
function resolveBackgroundUrl(value: string): string {
    if (value.startsWith('/')) {
        return FLEET_MANAGER_HTTP + value;
    }
    // Legacy absolute URL — re-resolve with current host
    if (value.startsWith('http')) {
        try {
            const path = new URL(value).pathname;
            return FLEET_MANAGER_HTTP + path;
        } catch { /* fall through */ }
    }
    return value;
}

const loadImages = async () => {
    try {
        const response = await apiClient.get('/media/getAllBackgrounds');

        // Map thumbnails and originals to backend URLs
        thumbnails.value = response.data.thumbnails.map(
            (file: string) => `${basePath}/${file}`
        );
        originals.value = response.data.originals.map(
            (file: string) => `${basePath}/${file}`
        );

        // Update the selected background based on the store value
        if (
            !background.value ||
            background.value === 'undefined' ||
            background.value == null
        ) {
            selectBackground(0, `${basePath}/app_bg_01_thumb.png`);
        } else if (background.value.includes('#')) {
            selectedColor.value = background.value;
            selectedIndex.value = null;
        } else if (background.value.includes('uploads')) {
            // Resolve relative/absolute stored path to full URL for display
            const resolvedUrl = resolveBackgroundUrl(background.value);
            selectedBackground.value = resolvedUrl;
            selectedIndex.value = originals.value.indexOf(resolvedUrl);
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
                selectedBackground.value = resolvedUrl;
                selectedIndex.value = orig.indexOf(resolvedUrl);
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
    const originalUrl = thumb.replace('_thumb', '');
    selectedBackground.value = originalUrl;
    selectedColor.value = null;
    // Store relative path so the background works across different hosts
    const filename = originalUrl.split('/').pop() || '';
    await setBackgroundImg(`/uploads/backgrounds/${filename}`);
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
    const input = $event.target as HTMLInputElement;
    if (input && input.files) {
        const originalFile = input.files[0];
        const fileExtension = originalFile.name.split('.').pop();
        const newFileName = `app_bg_${originals.value.length}.${fileExtension}`;
        const renamedFile = new File([originalFile], newFileName, {
            type: originalFile.type
        });
        fileProfile.value = renamedFile;

        const formData = new FormData();
        formData.append('image', renamedFile);

        try {
            const response = await apiClient.post(
                '/media/uploadBackgroud',
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
        }
    } else {
        toast.error('No file selected');
    }
};

function deleteBackground(image: number) {
    if (modalRefDelete.value) {
        modalRefDelete.value.storeAction(async () => {
            const fileName = originals.value[image].split('/').pop();
            apiClient
                .post(`/media/deleteBackground`, {fileName})
                .then(() => loadImages())
                .catch((err) => console.error('Failed to delete image', err));
        });
    }
}

function handleBackgroundChange(
    index?: number | null,
    thumb?: string | null,
    color?: string | null
) {
    if (modalRefChange.value) {
        modalRefChange.value.storeAction(async () => {
            if (index !== null && index !== undefined && thumb) {
                await selectBackground(index, thumb);
            } else if (color) {
                await selectBackgroundColor(color);
            }
        });
    }
}

// Lifecycle hook to initialize thumbnails
onMounted(async () => {
    await loadImages();
});
</script>

<style scoped>
.hidden-input {
    display: none;
}
</style>

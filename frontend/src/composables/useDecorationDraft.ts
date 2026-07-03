import {computed, ref} from 'vue';
import type {VisualAsset} from '@/api/assetRpc';

// A decoration is a picture or a colored icon — the two are mutually exclusive.
export interface Decoration {
    icon: string | null;
    accent: string | null;
    imageAssetId: string | null;
    imageModel: string | null;
}

// Single source of truth for editing a decoration with AssetPickerModal.
// Callers own persistence; this owns the in-flight picked value + the
// modal's event handlers so no surface repeats them.
export function useDecorationDraft() {
    const icon = ref<string | null>(null);
    const accent = ref<string | null>(null);
    const imageAssetId = ref<string | null>(null);
    const imageModel = ref<string | null>(null);

    function onSelectIcon(picked: {icon: string; accent: string | null}): void {
        icon.value = picked.icon;
        accent.value = picked.accent;
        imageAssetId.value = null;
        imageModel.value = null;
    }

    function onSelectAsset(asset: VisualAsset): void {
        imageAssetId.value = asset.id;
        icon.value = null;
        accent.value = null;
        imageModel.value = null;
    }

    function onSelectDevicePicture(picked: {model: string}): void {
        imageModel.value = picked.model;
        imageAssetId.value = null;
        icon.value = null;
        accent.value = null;
    }

    function reset(value: Partial<Decoration> = {}): void {
        icon.value = value.icon ?? null;
        accent.value = value.accent ?? null;
        imageAssetId.value = value.imageAssetId ?? null;
        imageModel.value = value.imageModel ?? null;
    }

    const hasDecoration = computed(
        () =>
            icon.value !== null ||
            imageAssetId.value !== null ||
            imageModel.value !== null
    );

    return {
        icon,
        accent,
        imageAssetId,
        imageModel,
        hasDecoration,
        onSelectIcon,
        onSelectAsset,
        onSelectDevicePicture,
        onClear: () => reset(),
        reset
    };
}

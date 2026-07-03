import type {Tag as ApiTag} from '@api/tag';
import {computed, ref, watch} from 'vue';
import {resolveAssetSrc} from '@/helpers/deviceLogo';

type TagVisualInput = Pick<ApiTag, 'icon' | 'imageAssetId'>;

// Single source of truth for a tag's leading visual: prefer a usable image,
// else a glyph, else nothing — a missing or broken image collapses rather than
// leaving an empty box. Consumers style their own chip/card around it.
export function useTagVisual(getTag: () => TagVisualInput | undefined) {
    const imgError = ref(false);

    const assetSrc = computed(() => {
        const id = getTag()?.imageAssetId;
        return id ? resolveAssetSrc(id) : '';
    });
    const hasImage = computed(
        () => !!getTag()?.imageAssetId && !!assetSrc.value && !imgError.value
    );
    const hasGlyph = computed(() => !!getTag()?.icon);
    const hasVisual = computed(() => hasImage.value || hasGlyph.value);
    const iconClass = computed(() => {
        const icon = getTag()?.icon;
        if (!icon) return '';
        return icon.includes(' ') ? icon : `fas fa-${icon}`;
    });

    // A new source clears a stale error (e.g. the tag was swapped).
    watch(assetSrc, () => {
        imgError.value = false;
    });

    function onImageError(): void {
        imgError.value = true;
    }

    return {assetSrc, hasImage, hasGlyph, hasVisual, iconClass, onImageError};
}

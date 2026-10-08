// Named reads off the one customization store, so no template re-implements
// the unwrap. The Vue binding exports the same four.

import {
    type PresentationCustomization,
    type ResolvedPresentationCustomization,
    resolvePresentationCustomization
} from '../../core/customization-presentation';
import {useCustomization} from './useFleetData';

/** The customization patch is deliberately open, so the caller names the type. */
export function useCustomizationField<T = unknown>(key: string): T | undefined {
    return useCustomization()[key] as T | undefined;
}

export function useNavLabels(): Record<string, string> {
    return useCustomizationField<Record<string, string>>('navLabels') ?? {};
}

export function useNavOrder(): string[] {
    return useCustomizationField<string[]>('navOrder') ?? [];
}

export function useThemeTokens(): Record<string, string> {
    return useCustomizationField<Record<string, string>>('theme') ?? {};
}

export function usePresentationCustomization(): ResolvedPresentationCustomization {
    return resolvePresentationCustomization(
        useCustomization() as PresentationCustomization
    );
}

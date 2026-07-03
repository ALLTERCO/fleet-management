import {type ComputedRef, computed} from 'vue';
import type {
    CustomNavItem,
    DashboardBlock,
    KpiWidget,
    SectionOverride,
    Vocabulary
} from '@/shell/customizationSchema';
import {useCustomizationField} from './customization';

export function usePortalNavLabels(): ComputedRef<Record<string, string>> {
    const labels = useCustomizationField('navLabels');
    return computed(() => labels.value ?? {});
}

export function usePortalCustomNavItems(): ComputedRef<CustomNavItem[] | null> {
    const items = useCustomizationField('customNavItems');
    return computed(() => items.value ?? null);
}

export function usePortalNavOrder(): ComputedRef<string[]> {
    const order = useCustomizationField('navOrder');
    return computed(() => order.value ?? []);
}

export function usePortalGroups() {
    const groups = useCustomizationField('groups');
    return computed(() => groups.value ?? null);
}

export function usePortalAlerts() {
    const alerts = useCustomizationField('alerts');
    return computed(() => alerts.value ?? null);
}

export function usePortalVocabulary(): ComputedRef<Vocabulary | null> {
    const vocab = useCustomizationField('vocabulary');
    return computed(() => vocab.value ?? null);
}

export function usePortalDashboardBlocks(): ComputedRef<
    DashboardBlock[] | null
> {
    const blocks = useCustomizationField('dashboardBlocks');
    return computed(
        () =>
            blocks.value?.map((block) => ({
                ...block,
                dataSources: block.dataSources ?? {}
            })) ?? null
    );
}

export function usePortalHiddenSections(): ComputedRef<unknown[] | null> {
    const hidden = useCustomizationField('hiddenSections');
    return computed(() => hidden.value ?? null);
}

export function usePortalKpis(): ComputedRef<SectionOverride<KpiWidget> | null> {
    const kpis = useCustomizationField('kpis');
    return computed(() => kpis.value ?? null);
}

export const useCustomNavItems = usePortalCustomNavItems;
export const useDashboardBlocks = usePortalDashboardBlocks;
export const useHiddenSections = usePortalHiddenSections;
export const useKpiOverrides = usePortalKpis;
export const useVocabulary = usePortalVocabulary;

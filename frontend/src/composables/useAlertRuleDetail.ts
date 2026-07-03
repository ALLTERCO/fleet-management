import {type Ref, ref} from 'vue';
import {UI_CONFIG} from '@/config/ui';
import {
    type AlertRuleFiring,
    type AlertRulePreviewMatch,
    useAlertsStore
} from '@/stores/alerts';

export interface RulePreviewResult {
    matches: AlertRulePreviewMatch[];
    matchCount: number;
    scanned: number;
    supportedKind: boolean;
    truncated: boolean;
    note: string | null;
}

/** Firing-history + preview view state for one rule. Data RPCs live in the store. */
export function useAlertRuleDetail(ruleId: Ref<number | null>) {
    const store = useAlertsStore();

    const firings = ref<AlertRuleFiring[]>([]);
    const firingsTotal = ref<number | null>(null);
    const firingsLoading = ref(false);
    const hasMoreFirings = ref(false);

    const previewRunning = ref(false);
    const previewResult = ref<RulePreviewResult | null>(null);

    async function fetchFirings(offset: number): Promise<void> {
        if (ruleId.value == null) return;
        firingsLoading.value = true;
        try {
            const res = await store.listFirings(
                ruleId.value,
                UI_CONFIG.firingsPageSize,
                offset
            );
            firings.value =
                offset === 0 ? res.items : [...firings.value, ...res.items];
            firingsTotal.value = res.total;
            hasMoreFirings.value = res.has_more;
        } finally {
            firingsLoading.value = false;
        }
    }

    function loadFirings(): Promise<void> {
        if (firingsLoading.value) return Promise.resolve();
        return fetchFirings(0);
    }

    function loadMoreFirings(): Promise<void> {
        return fetchFirings(firings.value.length);
    }

    async function runPreview(): Promise<void> {
        if (ruleId.value == null) return;
        previewRunning.value = true;
        previewResult.value = null;
        try {
            previewResult.value = await store.previewRule({
                ruleId: ruleId.value
            });
        } finally {
            previewRunning.value = false;
        }
    }

    function reset(): void {
        firings.value = [];
        firingsTotal.value = null;
        hasMoreFirings.value = false;
        previewResult.value = null;
    }

    return {
        firings,
        firingsTotal,
        firingsLoading,
        hasMoreFirings,
        previewRunning,
        previewResult,
        loadFirings,
        loadMoreFirings,
        runPreview,
        reset
    };
}

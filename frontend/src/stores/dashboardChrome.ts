import {defineStore} from 'pinia';
import {computed, ref} from 'vue';

// Two dashboard kinds drive the overflow (⋮) menu contents. Bento grids are
// user-built and layout-editable; domain dashboards (Energy, Environment, …)
// own their data controls in their own header and only expose rename here.
export type DashboardKind = 'bento' | 'domain';

export interface DashChromeActions {
    kind: DashboardKind;
    // Bento: enter layout edit. Domain: open the rename flow.
    onEdit: () => void;
    onSetDefault: () => void;
    // Bento only — copy the layout into a new dashboard. Absent when the user
    // lacks create permission or the kind can't be duplicated.
    onDuplicate?: () => void;
    // Domain dashboards with a live auto-refresh timer expose its cadence in
    // the ⋮ menu. Absent = the dashboard has no auto-refresh concept.
    refreshInterval?: number;
    onSetInterval?: (ms: number) => void;
    // User may update this dashboard (gates Edit / Set as default).
    canEdit: boolean;
    // User may share this dashboard (gates the Share item).
    canShare?: boolean;
    isDefault: boolean;
    loading: boolean;
}

export const useDashboardChromeStore = defineStore('dashboardChrome', () => {
    const actions = ref<DashChromeActions | null>(null);
    const hasActions = computed(() => actions.value !== null);

    function register(next: DashChromeActions): void {
        actions.value = next;
    }
    function clear(): void {
        actions.value = null;
    }

    return {actions, hasActions, register, clear};
});

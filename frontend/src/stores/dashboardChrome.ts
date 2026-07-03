import {defineStore} from 'pinia';
import {computed, ref} from 'vue';

export interface DashChromeActions {
    onRefresh: () => void;
    onShare: () => void;
    onToggleEdit: () => void;
    onAddWidget: () => void;
    onOpenManage: () => void;
    onOpenSettings?: () => void;
    settingsLabel?: string;
    canEdit: boolean;
    canShare: boolean;
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

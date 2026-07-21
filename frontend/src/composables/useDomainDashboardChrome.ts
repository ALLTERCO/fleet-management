// Shared shell-chrome wiring for domain dashboards (Energy, Environment, …).
// Every domain page registers the same overflow-menu shape: rename ("Edit
// dashboard"), Set as default, no layout edit / duplicate. The rename flow and
// permission/default state live here so each page only renders the modal.

import {computed, ref, watchEffect} from 'vue';
import {useAuthStore} from '@/stores/auth';
import {useDashboardChromeStore} from '@/stores/dashboardChrome';
import {useDashboardsStore} from '@/stores/dashboards';

export interface DomainDashboardChromeOptions {
    dashboardId: () => number;
    loading: () => boolean;
    currentName: () => string;
    // Reflect the persisted name back into the page's own title.
    onRenamed?: (name: string) => void;
}

export function useDomainDashboardChrome(opts: DomainDashboardChromeOptions) {
    const authStore = useAuthStore();
    const dashboardsStore = useDashboardsStore();
    const chrome = useDashboardChromeStore();

    const canEdit = computed(() => {
        const id = opts.dashboardId();
        return (
            Number.isFinite(id) &&
            authStore.canPerformComponent('dashboards', 'update', id)
        );
    });
    const isDefault = computed(() =>
        Boolean(dashboardsStore.dashboards[opts.dashboardId()]?.isDefault)
    );

    const renameVisible = ref(false);
    const renameSaving = ref(false);

    function openRename(): void {
        renameVisible.value = true;
    }

    async function saveRename(name: string): Promise<void> {
        const id = opts.dashboardId();
        if (!Number.isFinite(id)) return;
        renameSaving.value = true;
        try {
            const updated = await dashboardsStore.update(id, {name});
            if (updated) {
                opts.onRenamed?.(updated.name ?? name);
                renameVisible.value = false;
            }
        } finally {
            renameSaving.value = false;
        }
    }

    async function onSetDefault(): Promise<void> {
        const id = opts.dashboardId();
        if (Number.isFinite(id)) await dashboardsStore.setDefault(id);
    }

    watchEffect(() => {
        chrome.register({
            kind: 'domain',
            onEdit: openRename,
            onSetDefault: () => void onSetDefault(),
            canEdit: canEdit.value,
            isDefault: isDefault.value,
            loading: opts.loading()
        });
    });

    return {
        canEdit,
        isDefault,
        renameVisible,
        renameSaving,
        renameName: computed(() => opts.currentName()),
        openRename,
        saveRename
    };
}

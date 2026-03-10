<template>
    <div class="relative overflow-hidden h-screen">
        <h1 class="text-lg font-semibold mb-1">Dashboard</h1>
        <TabPageSelector :tabs="tabs" />

        <div class="absolute top-0 right-4">
            <Button narrow size="sm" @click="modal.open = true">
                <span>
                    <i class="fas fa-pencil" />
                </span>
            </Button>
        </div>
        <Modal :visible="modal.open" @close="modal.open = false">
            <template #title>Edit dashboards</template>
            <template #default>
                <div class="flex flex-col gap-4 p-2">
                    <!-- Dashboard Name -->
                    <Input
                        id="dash-name"
                        v-model="modal.name"
                        label="Dashboard Name"
                        type="text"
                        placeholder="My Dashboard"
                    />

                    <!-- Dashboard Type -->
                    <div>
                        <label class="block text-sm dash-label mb-2"
                            >Dashboard Type</label
                        >
                        <div class="flex gap-2">
                            <button
                                class="flex-1 px-4 py-3 rounded-lg border transition-colors text-left"
                                :class="
                                    modal.type === 'classic'
                                        ? 'dash-type-active'
                                        : 'dash-type-inactive'
                                "
                                @click="modal.type = 'classic'"
                            >
                                <div class="font-semibold">
                                    <i class="fas fa-th-large mr-2"></i>Classic
                                </div>
                                <div class="text-xs dash-label mt-1">
                                    Widgets for quick access
                                </div>
                            </button>
                            <button
                                class="flex-1 px-4 py-3 rounded-lg border transition-colors text-left"
                                :class="
                                    modal.type === 'analytics'
                                        ? 'dash-type-active'
                                        : 'dash-type-inactive'
                                "
                                @click="modal.type = 'analytics'"
                            >
                                <div class="font-semibold">
                                    <i class="fas fa-chart-line mr-2"></i
                                    >Analytics
                                </div>
                                <div class="text-xs dash-label mt-1">
                                    Metrics, charts &amp; reports for a group
                                </div>
                            </button>
                        </div>
                    </div>

                    <!-- Group Selector (for analytics) -->
                    <div v-if="modal.type === 'analytics'">
                        <label class="block text-sm dash-label mb-2"
                            >Select Device Group</label
                        >
                        <select
                            v-model="modal.groupId"
                            class="w-full dash-select px-3 py-2 rounded focus:outline-none"
                        >
                            <option :value="null" disabled>
                                Choose a group...
                            </option>
                            <option
                                v-for="group in groupsList"
                                :key="group.id"
                                :value="group.id"
                            >
                                {{ group.name }} ({{
                                    group.devices.length
                                }}
                                devices)
                            </option>
                        </select>
                        <p
                            v-if="groupsList.length === 0"
                            class="text-sm dash-warning-text mt-2"
                        >
                            <i class="fas fa-exclamation-triangle mr-1"></i>
                            No groups available. Create a device group first.
                        </p>
                    </div>

                    <!-- Add Button -->
                    <div class="flex justify-end">
                        <Button @click="createDash" :disabled="!canCreate">
                            <i class="fas fa-plus mr-2"></i>Create Dashboard
                        </Button>
                    </div>
                </div>
            </template>
            <template #footer>
                <div class="flex flex-col gap-2">
                    <h2 class="heading-section"
                        >Current dashboards</h2
                    >
                    <div
                        v-for="dashboard of sortedDashboards"
                        :key="'dash-id-' + dashboard.id"
                        class="flex flex-row gap-2 items-center"
                    >
                        <!-- Dashboard type icon -->
                        <span
                            class="w-8 text-center"
                            :title="
                                (dashboard as any).dashboard_type ===
                                'analytics'
                                    ? 'Analytics Dashboard'
                                    : 'Classic Dashboard'
                            "
                        >
                            <i
                                :class="
                                    (dashboard as any).dashboard_type ===
                                    'analytics'
                                        ? 'fas fa-chart-line dash-icon-analytics'
                                        : 'fas fa-th-large dash-icon-classic'
                                "
                            />
                        </span>
                        <div class="flex-grow">
                            <Input
                                :id="'dash-' + dashboard.id"
                                v-model="modal.renames[dashboard.id]"
                                :placeholder="dashboard.name"
                                :disabled="dashboard.id == 1"
                            />
                        </div>
                        <Button
                            narrow
                            type="blue"
                            :disabled="dashboard.id == 1"
                            @click="
                                renameDash(
                                    Number(dashboard.id),
                                    modal.renames[dashboard.id],
                                )
                            "
                        >
                            <i class="fas fa-save" />
                        </Button>
                        <Button
                            narrow
                            type="red"
                            :disabled="dashboard.id == 1"
                            @click="deleteDash(dashboard)"
                        >
                            <i class="fas fa-trash" />
                        </Button>
                    </div>
                </div>
            </template>
        </Modal>
    </div>
</template>

<script setup lang="ts">
import {computed, reactive, ref, watch} from 'vue';
import {useRouter} from 'vue-router/auto';
import Button from '@/components/core/Button.vue';
import Input from '@/components/core/Input.vue';
import TabPageSelector from '@/components/core/TabPageSelector.vue';
import Modal from '@/components/modals/Modal.vue';
import useRegistry from '@/composables/useRegistry';
import useUiRegistry from '@/composables/useUiRegistry';
import {useGroupsStore} from '@/stores/groups';
import {useToastStore} from '@/stores/toast';
import {getRegistry, sendRPC} from '@/tools/websocket';
import type {dashboard_t} from '@/types';

const {data, upload, refresh} = useUiRegistry<dashboard_t>('dashboards');
const toast = useToastStore();
const groupsStore = useGroupsStore();

const sortedDashboards = computed<dashboard_t[]>(() => {
    if (!data.value) return [];
    return Object.values(data.value);
});

const groupsList = computed(() => {
    return Object.values(groupsStore.groups);
});

const modal = reactive({
    open: false,
    name: '',
    type: 'classic' as 'classic' | 'analytics',
    groupId: null as number | null,
    renames: {} as Record<number | string, string>
});

const canCreate = computed(() => {
    if (modal.name.length < 1) return false;
    if (modal.type === 'analytics' && !modal.groupId) return false;
    return true;
});

const tabs = ref<[string, string, string][]>([]);

watch(
    data,
    (newData) => {
        if (newData) {
            for (const id in newData) {
                modal.renames[id] = (newData as any)[id]?.name ?? '';
            }
        }
        if (!newData || Object.values(newData).length === 0) {
            tabs.value = [];
        } else {
            tabs.value = Object.values(newData)
                .sort((a, b) => Number(a.id) - Number(b.id))
                .map((dash) => {
                    const {id, name, dashboard_type} = dash as any;
                    // Route analytics dashboards to the analytics page
                    const route =
                        dashboard_type === 'analytics'
                            ? `/dash/analytics/${id}`
                            : `/dash/${id}`;
                    const icon =
                        dashboard_type === 'analytics'
                            ? 'fas fa-chart-line'
                            : 'fas fa-th-large';
                    return [name, route, icon] as [string, string, string];
                });
        }
    },
    {immediate: true}
);

const router = useRouter();

async function createDash() {
    if (!canCreate.value) {
        return;
    }

    if (!data.value) {
        return;
    }

    const newDash: any = {
        name: modal.name,
        items: [],
        dashboardType: modal.type
    };

    // Add groupId for analytics dashboards
    if (modal.type === 'analytics' && modal.groupId) {
        newDash.groupId = modal.groupId;
    }

    try {
        const previousIds = new Set(
            Object.values(data.value).map((d) => d.id)
        );
        await getRegistry('ui').setItem('dashboards', newDash);
        await getDashboards();
        // Find the newly created dashboard (ID that didn't exist before)
        const all = Object.values(data.value!);
        const created = all.find((d) => !previousIds.has(d.id));
        const nextId = created?.id ?? all[all.length - 1]?.id;

        if (!nextId) {
            toast.error('Dashboard created but could not determine ID');
            return;
        }

        // Navigate to appropriate route based on type
        if (modal.type === 'analytics') {
            router.replace({
                path: `/dash/analytics/${nextId}`
            });
        } else {
            router.replace({
                name: '/dash/[id]',
                params: {id: nextId}
            });
        }
    } catch (error) {
        toast.error('Cannot create ' + modal.name);
    }

    modal.open = false;
    modal.name = '';
    modal.type = 'classic';
    modal.groupId = null;
}

async function deleteDash(dash: dashboard_t) {
    if (!data.value) return;
    try {
        const result = await getRegistry('ui').removeItem('dashboards', {
            id: dash.id
        });
        await getDashboards();
        router.push({
            name: '/dash/[id]',
            params: {
                id: 1
            }
        });
        delete data.value[dash.id];
        toast.success('Successfully deleted ' + dash.name);
    } catch (error) {
        toast.error('Cannot delete ' + dash.name);
    }
}

async function renameDash(id: number, newName: string) {
    if (!id || !newName) {
        toast.error('Invalid name');
        return;
    }
    await getRegistry('ui').setItem('dashboards', {
        id,
        name: newName,
        item: []
    });
    await getDashboards();
}

async function getDashboards() {
    return await getRegistry('ui')
        .getItem('dashboards')
        .then((response: any) => {
            data.value = response;
        })
        .catch((error) => {
            console.error('Error fetching dashboards:', error);
            return {};
        });
}
</script>

<style scoped>
/* -- Labels -- */
.dash-label { color: var(--color-text-tertiary); }
.dash-warning-text { color: var(--color-warning-text); }

/* -- Dashboard type selector -- */
.dash-type-active {
    border-color: var(--color-border-focus);
    background-color: color-mix(in srgb, var(--color-border-focus) 20%, transparent);
    color: var(--color-text-primary);
}
.dash-type-inactive {
    border-color: var(--color-border-strong);
    background-color: var(--color-surface-3);
    color: var(--color-text-secondary);
}
.dash-type-inactive:hover { border-color: var(--color-text-disabled); }

/* -- Group selector -- */
.dash-select {
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border-strong);
}
.dash-select:focus { border-color: var(--color-border-focus); }

/* -- Dashboard list icons -- */
.dash-icon-analytics { color: var(--color-success-text); }
.dash-icon-classic { color: var(--color-primary-text); }
</style>

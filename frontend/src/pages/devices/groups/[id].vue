<template>
    <div v-if="group" class="space-y-2">
        <Breadcrumbs :overrides="{ groups: 'Groups', [String(route.params.id)]: group.name }" />
        <InfiniteGridScrollPage
            :page="page"
            :total-pages="totalPages"
            :items="filteredItems"
            :loading="loading"
            @load-items="loadItems"
        >
            <template #header>
                <BasicBlock bordered blurred class="mb-2">
                    <div class="flex flex-col gap-3">
                        <div
                            class="flex flex-row flex-nowrap gap-2 justify-between align-middle items-center"
                        >
                            <div class="flex flex-row gap-2 items-center">
                                <div
                                    class="p-1 w-8 h-8 hover:border bg-[var(--color-surface-1)] align-middle border-[var(--color-primary)] rounded-md text-center text-sm hover:cursor-pointer"
                                    @click="handleGoBack()"
                                >
                                    <i class="fa-solid fa-chevron-left"></i>
                                </div>

                                <span class="font-semibold">{{
                                    group.name
                                }}</span>

                                <div
                                    class="flex flex-row gap-2 items-center justify-between"
                                >
                                    <div
                                        class="flex flex-row gap-2 items-baseline"
                                    >
                                        <Input
                                            v-model="nameFilter"
                                            placeholder="Search item"
                                            clear
                                            class="w-full"
                                            @focus="
                                                searchBarFocused =
                                                    !searchBarFocused
                                            "
                                        />
                                    </div>
                                </div>
                            </div>

                            <div class="flex flex-row gap-2">
                                <!-- ✅ Keep only PLUS (creates subgroup) -->
                                <Button
                                    type="blue"
                                    size="sm"
                                    class="mr-2"
                                    narrow
                                    @click="openCreateSubgroupModal"
                                >
                                    <i class="fas fa-plus" aria-hidden="true" />
                                    <span class="sr-only">Create subgroup</span>
                                </Button>

                                <Button
                                    type="blue"
                                    size="sm"
                                    class="mr-2"
                                    narrow
                                    @click="editModalVisible = true"
                                >
                                    <i class="fas fa-pencil" aria-hidden="true" />
                                    <span class="sr-only">Edit group</span>
                                </Button>
                            </div>
                        </div>

                        <div
                            class="flex flex-row gap-2 items-baseline justify-center"
                        >
                            <span class="w-full font-bold size-3">{{
                                entitiesCalculation
                            }}</span>
                        </div>
                    </div>
                </BasicBlock>
            </template>

            <!-- ✅ One list: groups first, then devices -->
            <template #default="{ item, small }">
                <GroupWidget
                    v-if="item.kind === 'group'"
                    :key="'g-' + item.group.id"
                    :name="item.group.name"
                    :members="item.group.devices ?? []"
                    :metadata="item.group.metadata"
                    :vertical="small"
                    class="hover:cursor-pointer"
                    @click="goToSubgroup(item.group.id)"
                >
                    <template #widget-action>
                        <Button type="red" size="sm" @click.stop="deleteChildGroup(item.group.id)"
                            >Delete</Button
                        >
                    </template>
                </GroupWidget>

                <DeviceWidget
                    v-else
                    :key="'d-' + item.shellyID"
                    :device-id="item.shellyID"
                    :selected="activeDevice === item.shellyID"
                    :vertical="small"
                    class="hover:cursor-pointer"
                    @click="deviceSelected(item.shellyID)"
                />
            </template>

            <template #empty>
                <EmptyBlock>
                    <p class="text-xl font-semibold pb-2">Group is empty.</p>
                    <p class="text-sm pb-2">
                        You can add subgroups using the plus button above, or
                        add devices from the edit modal.
                    </p>
                </EmptyBlock>
            </template>
        </InfiniteGridScrollPage>

        <EditGroupModal
            v-if="editModalVisible"
            v-model="editModalVisible"
            :name="group.name"
            :devices="group.devices"
            :metadata="group.metadata"
            @save="onSave"
        />

        <!-- Create subgroup modal -->
        <Modal
            :visible="createSubgroupModalVisible"
            @close="closeCreateSubgroupModal"
        >
            <template #title>
                <p class="text-2xl font-semibold">Create subgroup</p>
            </template>

            <template #default>
                <!-- Step 1 -->
                <div v-if="createStep === 1" class="flex flex-col gap-3">
                    <Input
                        v-model="newSubgroupName"
                        label="Subgroup name"
                        type="text"
                        placeholder="Enter subgroup name"
                    />
                </div>

                <!-- Step 2: metadata -->
                <div v-else class="flex flex-col gap-3">
                    <div class="text-sm text-[var(--color-text-secondary)]">
                        Metadata (key/value). Add as many rows as you want.
                    </div>

                    <div class="flex flex-col gap-2">
                        <div
                            v-for="(row, idx) in newSubgroupMetadataRows"
                            :key="idx"
                            class="flex flex-row gap-2 items-start"
                        >
                            <input
                                v-model="row.key"
                                class="w-[40%] rounded-md bg-[var(--color-surface-1)] border border-[var(--color-border-default)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                                placeholder="Key"
                            />
                            <input
                                v-model="row.value"
                                class="w-[60%] rounded-md bg-[var(--color-surface-1)] border border-[var(--color-border-default)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                                placeholder="Value"
                            />
                            <button
                                class="h-10 w-10 rounded-md bg-[var(--color-surface-1)] border border-[var(--color-border-default)] hover:bg-[var(--color-surface-2)] flex items-center justify-center"
                                title="Remove"
                                @click="removeNewMetadataRow(idx)"
                            >
                                <i class="fas fa-trash text-[var(--color-danger-text)]"></i>
                            </button>
                        </div>
                    </div>

                    <div class="flex flex-row gap-2">
                        <Button type="blue" @click="addNewMetadataRow"
                            >Add field</Button
                        >
                        <Button type="red" @click="clearNewMetadataRows"
                            >Clear</Button
                        >
                    </div>

                    <p v-if="metadataError" class="text-sm text-[var(--color-danger-text)]">
                        {{ metadataError }}
                    </p>
                </div>
            </template>

            <template #footer>
                <div class="flex flex-row gap-2">
                    <Button type="red" @click="closeCreateSubgroupModal"
                        >Cancel</Button
                    >

                    <template v-if="createStep === 1">
                        <Button type="blue" @click="goToMetadataStep"
                            >Next</Button
                        >
                    </template>

                    <template v-else>
                        <Button type="blue" @click="createStep = 1"
                            >Back</Button
                        >
                        <Button type="blue" @click="createSubgroup"
                            >Create</Button
                        >
                    </template>
                </div>
            </template>
        </Modal>

        <ConfirmationModal ref="modalRefDeleteChild">
            <template #title>
                <h1>
                    Are you sure you want to delete this group?
                </h1>
            </template>
        </ConfirmationModal>
    </div>

    <EmptyBlock v-else>
        <p class="text-xl font-semibold pb-2">Group does not exist.</p>
        <p class="text-sm pb-2">
            You can create a new group from the Groups page.
        </p>
        <Button type="blue" class="m-auto" @click="goToGroups"
            >Go to groups</Button
        >
    </EmptyBlock>
</template>

<script lang="ts" setup>
import {useRoute, useRouter} from 'vue-router/auto';

const route = useRoute('/devices/groups/[id]');

import {computed, onMounted, ref, watch} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import Breadcrumbs from '@/components/core/Breadcrumbs.vue';
import Button from '@/components/core/Button.vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import Input from '@/components/core/Input.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import EditGroupModal from '@/components/modals/EditGroupModal.vue';
import Modal from '@/components/modals/Modal.vue';
import InfiniteGridScrollPage from '@/components/pages/InfiniteGridScrollPage.vue';
import DeviceWidget from '@/components/widgets/DeviceWidget.vue';
import GroupWidget from '@/components/widgets/GroupWidget.vue';
import useInfiniteScroll from '@/composables/useInfiniteScroll';
import {DeviceBoard} from '@/helpers/components';
import {getDeviceName} from '@/helpers/device';
import {useDevicesStore} from '@/stores/devices';
import {useGroupsStore} from '@/stores/groups';
import {useRightSideMenuStore} from '@/stores/right-side';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';

const toast = useToastStore();
const router = useRouter();
const rightSideStore = useRightSideMenuStore();
const groupStore = useGroupsStore();
const deviceStore = useDevicesStore();

const activeDevice = ref<string>();

watch(() => rightSideStore.component, (comp) => {
    if (!comp) activeDevice.value = undefined;
});
const nameFilter = ref('');
const searchBarFocused = ref(false);

const editModalVisible = ref(false);

const id = computed(() => Number(route.params.id));
const group = computed(() => groupStore.groups[id.value]);

const childGroups = computed(() => {
    return Object.values(groupStore.groups)
        .filter((g: any) => g && (g.parentId ?? null) === id.value)
        .sort((a: any, b: any) => (a.name ?? '').localeCompare(b.name ?? ''));
});

const devices = computed(() => group.value?.devices || []);

type ListItem =
    | {kind: 'group'; group: any}
    | {kind: 'device'; shellyID: string};

const allItems = computed<ListItem[]>(() => {
    const groupsPart: ListItem[] = childGroups.value.map((g: any) => ({
        kind: 'group',
        group: g
    }));

    const devicesPart: ListItem[] = devices.value.map((shellyID: string) => ({
        kind: 'device',
        shellyID
    }));

    // ✅ groups first, then devices
    return [...groupsPart, ...devicesPart];
});

const {items, page, totalPages, loading, loadItems} =
    useInfiniteScroll(allItems);

async function refreshThisGroup() {
    if (!Number.isFinite(id.value)) return;
    await groupStore.fetchGroup(id.value);
    await groupStore.fetchChildren(id.value);
    loadItems();
}

onMounted(refreshThisGroup);

watch(
    () => id.value,
    async () => {
        await refreshThisGroup();
    }
);

async function onSave(
    name: string,
    devices: string[],
    metadata: Record<string, any>
) {
    await ws.sendRPC('FLEET_MANAGER', 'group.set', {
        id: id.value,
        name,
        devices,
        metadata: metadata ?? {}
    });
    await refreshThisGroup();
}

/**
 * ✅ filter for both groups and devices
 */
const filteredItems = computed(() => {
    const q = nameFilter.value.trim().toLowerCase();
    if (!q) return items.value;

    return items.value.filter((it: any) => {
        if (it.kind === 'group') {
            const g = it.group;
            return (
                (g?.name ?? '').toLowerCase().includes(q) ||
                String(g?.id ?? '').includes(q)
            );
        }

        const shellyID = it.shellyID;
        const device = getDeviceName(deviceStore.devices[shellyID]);
        const hay =
            (device as any)?.name?.toLowerCase() ||
            (device as any)?.jwt?.n?.toLowerCase() ||
            (device as any)?.id?.toLowerCase() ||
            shellyID.toLowerCase();

        return hay.includes(q);
    });
});

const entitiesCalculation = computed(() => {
    const total = items.value.length;
    const filtered = filteredItems.value.length;
    return nameFilter.value
        ? `Filtered ${filtered} from ${total} elements`
        : `Total ${total} elements`;
});

function deviceSelected(shellyID: string) {
    rightSideStore.setActiveComponent(DeviceBoard, {shellyID});
    activeDevice.value = shellyID;
}

function goToGroups() {
    router.push('/groups');
}

function handleGoBack() {
    if (window.history.length > 1) history.back();
    else router.push('/devices/groups');
}

function goToSubgroup(gid: number) {
    router.push({
        name: '/devices/groups/[id]',
        params: {id: gid}
    });
}

const modalRefDeleteChild = ref<InstanceType<typeof ConfirmationModal>>();

function deleteChildGroup(childId: number) {
    if (modalRefDeleteChild.value) {
        modalRefDeleteChild.value.storeAction(async () => {
            await ws.sendRPC('FLEET_MANAGER', 'group.delete', {id: childId});
            toast.info(`Group '${childId}' has been deleted.`);
            await refreshThisGroup();
        });
    }
}

/* ---------------- Create subgroup modal ---------------- */
const createSubgroupModalVisible = ref(false);
const createStep = ref<1 | 2>(1);
const newSubgroupName = ref('');
const metadataError = ref('');

type MetadataRow = {key: string; value: string};
const newSubgroupMetadataRows = ref<MetadataRow[]>([{key: '', value: ''}]);

function openCreateSubgroupModal() {
    createSubgroupModalVisible.value = true;
    createStep.value = 1;
    newSubgroupName.value = '';
    metadataError.value = '';
    newSubgroupMetadataRows.value = [{key: '', value: ''}];
}

function closeCreateSubgroupModal() {
    createSubgroupModalVisible.value = false;
    createStep.value = 1;
    newSubgroupName.value = '';
    metadataError.value = '';
    newSubgroupMetadataRows.value = [{key: '', value: ''}];
}

function goToMetadataStep() {
    if (!newSubgroupName.value.trim()) {
        metadataError.value = '';
        return;
    }
    createStep.value = 2;
}

function addNewMetadataRow() {
    newSubgroupMetadataRows.value.push({key: '', value: ''});
}

function removeNewMetadataRow(idx: number) {
    newSubgroupMetadataRows.value.splice(idx, 1);
    if (newSubgroupMetadataRows.value.length === 0) {
        newSubgroupMetadataRows.value.push({key: '', value: ''});
    }
}

function clearNewMetadataRows() {
    newSubgroupMetadataRows.value = [{key: '', value: ''}];
}

function buildMetadataOrThrow(rows: MetadataRow[]): Record<string, any> {
    const out: Record<string, any> = {};
    const seen = new Set<string>();

    for (const r of rows) {
        const key = (r.key ?? '').trim();
        const value = (r.value ?? '').trim();

        if (!key && !value) continue;

        if (!key)
            throw new Error(
                'Metadata key cannot be empty (remove the row or fill the key).'
            );
        if (seen.has(key)) throw new Error(`Duplicate metadata key: '${key}'.`);
        seen.add(key);

        out[key] = value;
    }

    return out;
}

async function createSubgroup() {
    metadataError.value = '';

    const name = newSubgroupName.value.trim();
    if (!name) {
        createStep.value = 1;
        return;
    }

    let metadata: Record<string, any> = {};
    try {
        metadata = buildMetadataOrThrow(newSubgroupMetadataRows.value);
    } catch (e: any) {
        metadataError.value = e?.message ?? 'Invalid metadata.';
        return;
    }

    try {
        await ws.sendRPC('FLEET_MANAGER', 'group.create', {
            name,
            parentId: id.value,
            metadata
        });
        closeCreateSubgroupModal();
        await refreshThisGroup();
    } catch (e) {
        console.error('[Groups] Failed to create subgroup:', e);
    }
}
</script>

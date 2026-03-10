<template>
    <InfiniteGridScrollPage
        :page="page"
        :total-pages="totalPages"
        :items="filteredItems"
        :loading="loading"
        @load-items="loadItems"
    >
        <template #header>
            <BasicBlock blurred bordered class="mb-2">
                <div class="flex flex-col gap-3">
                    <div
                        class="flex flex-row flex-nowrap gap-2 justify-between align-middle items-center"
                    >
                        <div
                            class="flex flex-row gap-2 items-center justify-between"
                        >
                            <div class="flex flex-row gap-2 items-baseline">
                                <Input
                                    v-model="nameFilter"
                                    placeholder="Search group"
                                    clear
                                    @focus="
                                        searchBarFocused = !searchBarFocused
                                    "
                                />
                            </div>
                        </div>

                        <div v-if="canWrite">
                            <Button
                                size="sm"
                                type="blue"
                                class="mr-2"
                                narrow
                                @click="openCreateGroupModal"
                                ><i class="fas fa-plus"
                            /></Button>
                            <Button
                                v-if="!editMode"
                                size="sm"
                                type="blue"
                                narrow
                                @click="editMode = true"
                                ><i class="fas fa-pencil"
                            /></Button>
                            <Button
                                v-else
                                size="sm"
                                type="red"
                                narrow
                                @click="editMode = false"
                                >Exit edit mode</Button
                            >
                        </div>
                    </div>
                    <div
                        class="flex flex-row gap-2 items-baseline justify-center"
                    >
                        <span class="w-full font-bold size-3">{{
                            groupsFilterMsg
                        }}</span>
                    </div>
                </div>
            </BasicBlock>

            <!-- Modal for creating -->
            <Modal
                :visible="isCreateGroupModalActive"
                @close="closeCreateModal"
            >
                <template #title>
                    <p class="text-2xl font-semibold">Create Group</p>
                </template>

                <template #default>
                    <!-- Step 1: name -->
                    <div v-if="createStep === 1" class="flex flex-col gap-3">
                        <Input
                            v-model="newGroupName"
                            label="Group name"
                            type="text"
                            placeholder="Enter group name"
                        />
                    </div>

                    <!-- Step 2: metadata (key/value rows) -->
                    <div v-else class="flex flex-col gap-3">
                        <div class="text-sm text-[var(--color-text-secondary)]">
                            Metadata (key/value). You can add as many rows as
                            you want.
                        </div>

                        <div class="flex flex-col gap-2">
                            <div
                                v-for="(row, idx) in newGroupMetadataRows"
                                :key="idx"
                                class="flex flex-row gap-2 items-start"
                            >
                                <input
                                    v-model="row.key"
                                    class="w-[40%] rounded-md bg-[var(--color-surface-1)] border border-[var(--color-border-default)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                                    placeholder="Key (e.g. site)"
                                    aria-label="Metadata key"
                                />
                                <input
                                    v-model="row.value"
                                    class="w-[60%] rounded-md bg-[var(--color-surface-1)] border border-[var(--color-border-default)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                                    placeholder="Value (e.g. HQ)"
                                    aria-label="Metadata value"
                                />
                                <button
                                    class="h-10 w-10 rounded-md bg-[var(--color-surface-1)] border border-[var(--color-border-default)] hover:bg-[var(--color-surface-2)] flex items-center justify-center"
                                    title="Remove"
                                    @click="removeMetadataRow(idx)"
                                >
                                    <i class="fas fa-trash text-[var(--color-danger-text)]"></i>
                                </button>
                            </div>
                        </div>

                        <div class="flex flex-row gap-2">
                            <Button type="blue" @click="addMetadataRow"
                                >Add field</Button
                            >
                            <Button type="red" @click="clearMetadataRows"
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
                        <Button type="red" @click="closeCreateModal"
                            >Cancel</Button
                        >

                        <template v-if="createStep === 1">
                            <Button
                                type="blue"
                                class="mr-2"
                                :requires-write="true"
                                @click="goToMetadataStep"
                                >Next</Button
                            >
                        </template>

                        <template v-else>
                            <Button
                                type="blue"
                                :requires-write="true"
                                @click="createStep = 1"
                                >Back</Button
                            >
                            <Button
                                type="blue"
                                class="mr-2"
                                :requires-write="true"
                                @click="handleCreateGroup"
                                >Create</Button
                            >
                        </template>
                    </div>
                </template>
            </Modal>
        </template>

        <template #default="{ item: group, small }">
            <GroupWidget
                v-if="group?.id"
                :key="group.id"
                :name="group.name"
                :members="group.devices"
                :metadata="group.metadata"
                :vertical="small"
                class="hover:cursor-pointer"
                @click="!editMode && groupClicked(group.id)"
            >
                <template v-if="editMode" #widget-action>
                    <Button type="red" @click="deleteGroup(group.id)"
                        >Delete</Button
                    >
                </template>
            </GroupWidget>
        </template>

        <template #empty>
            <div v-if="groupsLoading" class="widget-grid p-4">
                <Skeleton v-for="n in 6" :key="n" variant="card" />
            </div>
            <EmptyBlock v-else>
                <p class="text-xl font-semibold pb-2">No groups found</p>
                <p class="text-sm pb-2">
                    Groups are a collection of devices. Create one by clicking
                    the button below
                </p>
                <Button
                    v-if="canWrite"
                    type="blue"
                    @click="openCreateGroupModal"
                    >Create a group</Button
                >
                <p v-else class="text-[var(--color-warning-text)] text-sm">
                    You have read-only access.
                </p>
            </EmptyBlock>
        </template>
    </InfiniteGridScrollPage>

    <ConfirmationModal ref="modalRefDelete">
        <template #title>
            <h1>
                Are you sure you want to delete this group?
            </h1>
        </template>
    </ConfirmationModal>
</template>

<script setup lang="ts">
import {storeToRefs} from 'pinia';
import {computed, onMounted, ref} from 'vue';
import {useRouter} from 'vue-router/auto';
import BasicBlock from '@/components/core/BasicBlock.vue';
import Button from '@/components/core/Button.vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import Input from '@/components/core/Input.vue';
import Skeleton from '@/components/core/Skeleton.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import Modal from '@/components/modals/Modal.vue';
import InfiniteGridScrollPage from '@/components/pages/InfiniteGridScrollPage.vue';
import GroupWidget from '@/components/widgets/GroupWidget.vue';
import useInfiniteScroll from '@/composables/useInfiniteScroll';
import {usePermissions} from '@/composables/usePermissions';
import {useGroupsStore} from '@/stores/groups';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';

const {canWrite} = usePermissions();

const isCreateGroupModalActive = ref(false);
const createStep = ref<1 | 2>(1);

const newGroupName = ref('');
const metadataError = ref<string>('');

type MetadataRow = {key: string; value: string};
const newGroupMetadataRows = ref<MetadataRow[]>([{key: '', value: ''}]);

const toast = useToastStore();
const editMode = ref(false);
const nameFilter = ref('');
const searchBarFocused = ref(false);

const router = useRouter();
const groupStore = useGroupsStore();
const {loading: groupsLoading} = storeToRefs(groupStore);

const groups = computed(() => {
    return groupStore.groups;
});

/**
 * ✅ Root groups only: shown only at their level.
 * If parentId is undefined (older groups), treat as root.
 */
function isRootGroup(group: any) {
    return group?.parentId === null || typeof group?.parentId === 'undefined';
}

const values = computed(() => Object.values(groups.value).filter(isRootGroup));

const {items, page, totalPages, loading, loadItems} = useInfiniteScroll(values);
const modalRefDelete = ref<InstanceType<typeof ConfirmationModal>>();

function groupClicked(id: number) {
    router.push({
        name: '/devices/groups/[id]',
        params: {
            id
        }
    });
}

const filteredItems = computed(() => {
    return items.value.filter((group: any) => {
        return (group.name ?? '')
            .toLowerCase()
            .includes(nameFilter.value.toLowerCase());
    });
});

const groupsFilterMsg = computed(() => {
    const total = items.value.length;
    const filtered = filteredItems.value.length;
    return `Showing ${filtered}/${total} groups.`;
});

function openCreateGroupModal() {
    isCreateGroupModalActive.value = true;
    createStep.value = 1;
    metadataError.value = '';
    if (newGroupMetadataRows.value.length === 0) {
        newGroupMetadataRows.value = [{key: '', value: ''}];
    }
}

function closeCreateModal() {
    isCreateGroupModalActive.value = false;
    createStep.value = 1;
    newGroupName.value = '';
    newGroupMetadataRows.value = [{key: '', value: ''}];
    metadataError.value = '';
}

function goToMetadataStep() {
    if (!newGroupName.value) {
        toast.error('Group name cannot be empty.');
        return;
    }
    createStep.value = 2;
}

function addMetadataRow() {
    newGroupMetadataRows.value.push({key: '', value: ''});
}

function removeMetadataRow(idx: number) {
    newGroupMetadataRows.value.splice(idx, 1);
    if (newGroupMetadataRows.value.length === 0) {
        newGroupMetadataRows.value.push({key: '', value: ''});
    }
}

function clearMetadataRows() {
    newGroupMetadataRows.value = [{key: '', value: ''}];
}

function buildMetadataOrThrow(rows: MetadataRow[]): Record<string, any> {
    const out: Record<string, any> = {};
    const seen = new Set<string>();

    for (const r of rows) {
        const key = (r.key ?? '').trim();
        const value = (r.value ?? '').trim();

        // ignore fully empty row
        if (!key && !value) continue;

        if (!key) {
            throw new Error(
                'Metadata key cannot be empty (remove the row or fill the key).'
            );
        }

        if (seen.has(key)) {
            throw new Error(`Duplicate metadata key: '${key}'.`);
        }
        seen.add(key);

        // store as string (simple + predictable for users)
        out[key] = value;
    }

    return out;
}

function deleteGroup(id: number) {
    if (modalRefDelete.value) {
        modalRefDelete.value.storeAction(async () => {
            await ws.sendRPC('FLEET_MANAGER', 'group.delete', {id});
            toast.info(`Group '${id}' has been deleted.`);
            await groupStore.fetchGroups();
            loadItems();
        });
    }
}

onMounted(() => {
    // Groups are already fetched by websocket onConnect. Only re-fetch if store is empty.
    if (Object.keys(groupStore.groups).length === 0) {
        groupStore.fetchGroups().then(() => loadItems());
    } else {
        loadItems();
    }
});

async function handleCreateGroup() {
    if (!newGroupName.value) {
        toast.error('Group name cannot be empty.');
        createStep.value = 1;
        return;
    }

    metadataError.value = '';
    let metadata: Record<string, any> = {};

    try {
        metadata = buildMetadataOrThrow(newGroupMetadataRows.value);
    } catch (err: any) {
        metadataError.value = err?.message ?? 'Invalid metadata.';
        return;
    }

    try {
        await ws.sendRPC('FLEET_MANAGER', 'group.create', {
            name: newGroupName.value,
            metadata,
            // ✅ explicitly root
            parentId: null
        });

        closeCreateModal();
        groupStore.fetchGroups();
    } catch (err: any) {
        toast.error(err?.message ?? 'Error creating the group');
    }
}
</script>

<style scoped>
@reference "tailwindcss";
.modal-background {
    width: 100vw;
    height: 100vh;
    background-color: rgba(1, 1, 1, 0.7);
    position: fixed;
    top: 0;
    left: 0;
    z-index: var(--z-overlay);
}

.modal-card {
    z-index: var(--z-modal);
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    @apply bg-[var(--color-surface-2)] p-4 rounded-md;
}
</style>

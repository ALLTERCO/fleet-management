<template>
    <PageTemplate title="User Groups" :tabs="tabs" fill>
        <div class="ug-layout">
            <h2 class="sr-only">User Groups</h2>

            <BasicBlock darker title="User Groups">
                <div class="ug-toolbar">
                    <div class="search-pill">
                        <i class="fas fa-search search-pill__icon" />
                        <input
                            v-model.trim="search"
                            type="text"
                            class="search-pill__input"
                            placeholder="Search groups…"
                            aria-label="Search"
                        />
                    </div>
                    <Button v-if="canCreateGroup" type="green" narrow title="New group" aria-label="New group" @click="openCreate">
                        <i class="fas fa-plus" />
                    </Button>
                </div>

                <DataList
                    :rows="filtered"
                    :columns="columns"
                    row-key="id"
                    :loading="store.loading"
                    empty-message="No user groups yet."
                >
                    <template #cell-actions="{row}">
                        <button
                            type="button"
                            class="ug-action-btn"
                            :title="`Members of ${row.name}`"
                            @click="openMembers(row)"
                        >
                            <i class="fas fa-users" />
                        </button>
                        <button
                            type="button"
                            class="ug-action-btn"
                            :title="`Personas attached to ${row.name}`"
                            @click="openAssignments(row)"
                        >
                            <i class="fas fa-id-badge" />
                        </button>
                        <button
                            type="button"
                            v-if="canUpdateGroup"
                            class="ug-action-btn"
                            :title="`Edit ${row.name}`"
                            :aria-label="`Edit ${row.name}`"
                            @click="openEdit(row)"
                        >
                            <i class="fas fa-pen" />
                        </button>
                        <button
                            type="button"
                            v-if="canDeleteGroup"
                            class="ug-action-btn ug-action-btn--danger"
                            :title="`Delete ${row.name}`"
                            :aria-label="`Delete ${row.name}`"
                            @click="confirmDelete(row)"
                        >
                            <i class="fas fa-trash" />
                        </button>
                    </template>
                </DataList>
            </BasicBlock>
        </div>

        <template #modals>
            <!-- Create / Edit Modal -->
            <Modal :visible="modalVisible" compact @close="closeModal">
                <template #title>
                    {{ editingId ? 'Edit Group' : 'Create Group' }}
                </template>

                <form class="ug-form" @submit.prevent="save">
                    <FormField label="Name" :error="errors.name">
                        <Input v-model="form.name" placeholder="Lobby Operators" />
                    </FormField>
                    <FormField label="Description">
                        <Input
                            v-model="form.description"
                            placeholder="Group purpose…"
                        />
                    </FormField>
                </form>

                <template #footer>
                    <div class="ug-modal-footer">
                        <Button type="white" @click="closeModal">Cancel</Button>
                        <Button type="blue" :disabled="saving" @click="save">
                            {{ saving ? 'Saving…' : 'Save' }}
                        </Button>
                    </div>
                </template>
            </Modal>

            <!-- Members Modal -->
            <Modal
                :visible="membersVisible"
                compact
                @close="membersVisible = false"
            >
                <template #title>Members — {{ membersTargetName }}</template>
                <div v-if="membersLoading" class="ug-loading">Loading…</div>
                <div v-else>
                    <div
                        v-if="currentMembers.length === 0"
                        class="ug-empty"
                    >
                        No members yet.
                    </div>
                    <ul v-else class="ug-member-list">
                        <li
                            v-for="uid in currentMembers"
                            :key="uid"
                            class="ug-member-row"
                        >
                            <span class="ug-member-id">{{ uid }}</span>
                            <button
                                type="button"
                                v-if="canRemoveMember"
                                class="ug-action-btn ug-action-btn--danger"
                                :title="`Remove ${uid}`"
                                @click="removeMember(uid)"
                            >
                                <i class="fas fa-times" />
                            </button>
                        </li>
                    </ul>

                    <div v-if="canAddMember" class="ug-add-row">
                        <FormField label="Add user (Zitadel sub UUID)">
                            <Input
                                v-model="addUserId"
                                placeholder="00000000-0000-0000-0000-000000000000"
                            />
                        </FormField>
                        <Button
                            type="green"
                            narrow
                            :disabled="!addUserId.trim() || addingMember"
                            @click="addMember"
                        >
                            Add
                        </Button>
                    </div>
                </div>
            </Modal>

            <!-- Assignments Modal -->
            <Modal
                :visible="assignmentsVisible"
                wide
                @close="assignmentsVisible = false"
            >
                <template #title>
                    Personas — {{ assignmentsTargetName }}
                </template>
                <AssignmentsPanel
                    v-if="assignmentsTargetId"
                    subject-type="user_group"
                    :subject-id="assignmentsTargetId"
                />
            </Modal>

            <ConfirmationModal ref="deleteRef">
                <template #title>
                    <h3>Delete group "{{ deleteTargetName }}"?</h3>
                </template>
                <template #subText>
                    <p class="ug-hint">
                        Refused if any assignment still references it.
                    </p>
                </template>
            </ConfirmationModal>
        </template>
    </PageTemplate>
</template>

<script setup lang="ts">
import {
    type ComponentPublicInstance,
    type ComputedRef,
    computed,
    inject,
    onMounted,
    reactive,
    ref
} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import Button from '@/components/core/Button.vue';
import DataList, {type DataColumn} from '@/components/core/DataList.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import Modal from '@/components/modals/Modal.vue';
import AssignmentsPanel from '@/components/panels/AssignmentsPanel.vue';
import {useRpcPermissions} from '@/helpers/rpcPermissions';
import {useToastStore} from '@/stores/toast';
import {
    type UserGroupResponse,
    useUserGroupsStore
} from '@/stores/userGroups';
import type {RouteTab} from '@/types/page-template';

const tabs = inject<ComputedRef<RouteTab[]>>(
    'settingsTabs',
    computed(() => [])
);

const store = useUserGroupsStore();
const toast = useToastStore();
const rpc = useRpcPermissions();
const canCreateGroup = computed(() => rpc.canCall('user_group.create'));
const canUpdateGroup = computed(() => rpc.canCall('user_group.update'));
const canDeleteGroup = computed(() => rpc.canCall('user_group.delete'));
const canAddMember = computed(() => rpc.canCall('user_group.addmembers'));
const canRemoveMember = computed(() => rpc.canCall('user_group.removemembers'));

const search = ref('');
const groups = computed(() => Object.values(store.groups));
const filtered = computed(() => {
    const all = groups.value;
    if (!search.value) return all;
    const q = search.value.toLowerCase();
    return all.filter(
        (g) =>
            g.name.toLowerCase().includes(q) ||
            (g.description?.toLowerCase().includes(q) ?? false)
    );
});

const columns: DataColumn<UserGroupResponse>[] = [
    {key: 'name', label: 'Name', role: 'primary'},
    {
        key: 'description',
        label: 'Description',
        role: 'secondary',
        accessor: (g) => g.description || '—'
    },
    {key: 'member_count', label: 'Members', role: 'meta', align: 'center'},
    {key: 'actions', label: '', role: 'action', align: 'right'}
];

onMounted(() => {
    store.fetchAll();
});

const modalVisible = ref(false);
const editingId = ref<string | null>(null);
const saving = ref(false);
const form = reactive({name: '', description: ''});
const errors = reactive({name: ''});

function resetForm() {
    form.name = '';
    form.description = '';
    errors.name = '';
}

function openCreate() {
    resetForm();
    editingId.value = null;
    modalVisible.value = true;
}

function openEdit(g: UserGroupResponse) {
    resetForm();
    editingId.value = g.id;
    form.name = g.name;
    form.description = g.description ?? '';
    modalVisible.value = true;
}

function closeModal() {
    modalVisible.value = false;
    editingId.value = null;
}

async function save() {
    errors.name = form.name.trim() ? '' : 'Name is required';
    if (errors.name) return;
    if (editingId.value ? !canUpdateGroup.value : !canCreateGroup.value) return;

    saving.value = true;
    try {
        if (editingId.value) {
            const ok = await store.update({
                id: editingId.value,
                name: form.name.trim(),
                description: form.description.trim() || undefined
            });
            if (ok) {
                toast.success('Group updated');
                closeModal();
            }
        } else {
            const created = await store.create({
                name: form.name.trim(),
                description: form.description.trim() || undefined
            });
            if (created) {
                toast.success('Group created');
                closeModal();
            }
        }
    } finally {
        saving.value = false;
    }
}

const membersVisible = ref(false);
const membersTargetId = ref<string | null>(null);
const membersTargetName = ref('');
const membersLoading = ref(false);
const addUserId = ref('');
const addingMember = ref(false);

const currentMembers = computed(() => {
    if (!membersTargetId.value) return [];
    return store.members[membersTargetId.value] ?? [];
});

async function openMembers(g: UserGroupResponse) {
    membersTargetId.value = g.id;
    membersTargetName.value = g.name;
    membersVisible.value = true;
    membersLoading.value = true;
    try {
        await store.fetchMembers(g.id);
    } finally {
        membersLoading.value = false;
    }
}

async function addMember() {
    if (!canAddMember.value) return;
    if (!membersTargetId.value || !addUserId.value.trim()) return;
    addingMember.value = true;
    try {
        const ok = await store.addMembers(membersTargetId.value, [
            addUserId.value.trim()
        ]);
        if (ok) {
            toast.success('Member added');
            addUserId.value = '';
        }
    } finally {
        addingMember.value = false;
    }
}

async function removeMember(uid: string) {
    if (!canRemoveMember.value) return;
    if (!membersTargetId.value) return;
    const ok = await store.removeMembers(membersTargetId.value, [uid]);
    if (ok) toast.success('Member removed');
}

const assignmentsVisible = ref(false);
const assignmentsTargetId = ref<string | null>(null);
const assignmentsTargetName = ref('');

function openAssignments(g: UserGroupResponse) {
    assignmentsTargetId.value = g.id;
    assignmentsTargetName.value = g.name;
    assignmentsVisible.value = true;
}

type ConfirmationModalHandle = ComponentPublicInstance & {
    storeAction: (action: () => Promise<unknown>) => void;
};
const deleteRef = ref<ConfirmationModalHandle | null>(null);
const deleteTargetName = ref('');

function confirmDelete(g: UserGroupResponse) {
    if (!canDeleteGroup.value) return;
    deleteTargetName.value = g.name;
    deleteRef.value?.storeAction(async () => {
        const ok = await store.remove(g.id);
        if (ok) toast.success('Group deleted');
    });
}
</script>

<style scoped>
.ug-layout {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    padding-top: var(--gap-sm);
}
.ug-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--gap-sm);
    margin-bottom: var(--gap-sm);
}
.ug-toolbar .search-pill {
    flex: 1 1 200px;
    max-width: 320px;
}
.ug-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--gap-lg);
    height: var(--gap-lg);
    border: none;
    border-radius: var(--radius-md);
    color: var(--color-primary-text);
    background: transparent;
    cursor: pointer;
    transition: background-color var(--duration-fast);
}
.ug-action-btn:hover:not(:disabled) {
    background-color: var(--color-primary-subtle);
}
.ug-action-btn--danger {
    color: var(--color-danger-text);
}
.ug-action-btn--danger:hover:not(:disabled) {
    background-color: var(--color-danger-subtle);
}
.ug-form {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
}
.ug-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--gap-xs);
}
.ug-loading,
.ug-empty {
    padding: var(--gap-md);
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.ug-member-list {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
    margin: 0 0 var(--gap-md);
    padding: 0;
    list-style: none;
}
.ug-member-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
    padding: var(--gap-xs) var(--gap-sm);
    background-color: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
}
.ug-member-id {
    font-family: var(--font-mono);
    font-size: var(--type-body);
    color: var(--color-text-primary);
}
.ug-add-row {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--gap-sm);
}
.ug-add-row > :first-child {
    flex: 1 1 200px;
}
.ug-hint {
    color: var(--color-text-quaternary);
    font-size: var(--type-card-footer);
}
</style>

<template>
    <PageTemplate title="Users" :tabs="tabs" fill>
    <div class="users-layout">
        <h2 class="sr-only">Users</h2>
        <ErrorBoundary>
        <!-- Zitadel unavailable banner. Suppressed in dev mode, where the UI
             is still rendered for visual review (RPCs won't persist). -->
        <div
            v-if="store.zitadelAvailable === false && !devPreview"
            class="usr-warning"
        >
            <div class="usr-warning__header">
                <i class="fas fa-exclamation-triangle" />
                <span>Zitadel Management API Not Available</span>
            </div>
            <p class="usr-warning__body">
                The Zitadel Management PAT is not configured. User management requires a valid Personal Access Token.
            </p>
        </div>

        <!-- Dev preview note — UI shown without Zitadel; changes don't persist. -->
        <div
            v-if="devPreview && store.zitadelAvailable !== true"
            class="usr-devnote"
        >
            <i class="fas fa-flask" aria-hidden="true" />
            <span>Dev preview — Zitadel isn't configured, so creating or editing users won't persist.</span>
        </div>

        <!-- Loading state -->
        <div
            v-if="store.zitadelAvailable === null && !devPreview"
            class="usr-panel"
        >
            <div class="usr-panel__body usr-panel__body--center">
                <Spinner />
                <p class="usr-hint">Checking Zitadel availability...</p>
            </div>
        </div>

        <!-- User management (Zitadel available, or dev preview) -->
        <template v-if="store.zitadelAvailable || devPreview">
            <div class="usr-panel">
                <div class="usr-panel__head">
                    <div v-if="canManageUsers || devPreview" class="route-tabs">
                        <div class="route-tabs__track" :class="{'route-tabs__track--end': usersView === 'service'}" />
                        <button type="button" class="route-tabs__btn" :class="{'route-tabs__btn--active': usersView === 'human'}" @click="usersView = 'human'">Users</button>
                        <button type="button" class="route-tabs__btn" :class="{'route-tabs__btn--active': usersView === 'service'}" @click="usersView = 'service'">Service</button>
                    </div>
                    <div class="search-pill usr-search">
                        <i class="fas fa-search search-pill__icon" />
                        <input v-model.trim="userSearch" type="text" class="search-pill__input" :placeholder="usersView === 'human' ? 'Search users…' : 'Search service users…'" aria-label="Search" />
                        <button v-if="userSearch" type="button" class="search-pill__clear" @click="userSearch = ''"><i class="fas fa-xmark" /></button>
                    </div>
                    <Button v-if="usersView === 'human' && (canManageUsers || devPreview)" type="green" narrow title="New user" aria-label="New user" @click="openCreateModal">
                        <i class="fas fa-plus" />
                    </Button>
                    <Button v-else-if="usersView === 'service' && (canManageServiceUsers || devPreview)" type="green" narrow title="New service user" aria-label="New service user" @click="openCreateServiceUserModal">
                        <i class="fas fa-plus" />
                    </Button>
                </div>
                <div class="usr-panel__body">
                    <!-- Human users view -->
                    <template v-if="usersView === 'human'">
                    <DataList
                        :rows="filteredUsers"
                        :columns="humanColumns"
                        row-key="userId"
                        :loading="store.loading"
                        empty-message="No users found in this organization"
                        :error-message="store.fetchError || null"
                    >
                        <template #cell-status="{row}">
                            <span class="usr-status" :class="isActive(row) ? 'usr-status--active' : 'usr-status--inactive'">
                                {{ isActive(row) ? 'Active' : 'Inactive' }}
                            </span>
                        </template>
                        <template #cell-actions="{row}">
                            <template v-if="canManageUsers">
                                <button type="button" class="user-action-btn" :title="`Edit ${row.displayName || row.userName}`" :aria-label="`Edit ${row.displayName || row.userName}`" @click="openEditUser(row)">
                                    <i class="fas fa-pen" />
                                </button>
                                <button type="button" class="user-action-btn user-action-btn--warning" :title="`Reset password for ${row.displayName || row.userName}`" :aria-label="`Reset password for ${row.displayName || row.userName}`" @click="confirmResetPassword(row)">
                                    <i class="fas fa-key" />
                                </button>
                                <button v-if="isActive(row)" type="button" class="user-action-btn user-action-btn--danger" :title="`Deactivate ${row.displayName || row.userName}`" :aria-label="`Deactivate ${row.displayName || row.userName}`" @click="toggleActive(row)">
                                    <i class="fas fa-user-slash" />
                                </button>
                                <button v-else type="button" class="user-action-btn user-action-btn--success" :title="`Reactivate ${row.displayName || row.userName}`" :aria-label="`Reactivate ${row.displayName || row.userName}`" @click="toggleActive(row)">
                                    <i class="fas fa-user-check" />
                                </button>
                                <button v-if="canManageUsers" type="button" class="user-action-btn user-action-btn--danger" :title="`Delete ${row.displayName || row.userName} (permanent)`" :aria-label="`Delete ${row.displayName || row.userName}`" @click="confirmDeleteUser(row)">
                                    <i class="fas fa-trash" />
                                </button>
                            </template>
                        </template>
                    </DataList>
                    </template>

                    <!-- Service users view -->
                    <template v-if="usersView === 'service'">
                    <DataList
                        :rows="filteredServiceUsers"
                        :columns="serviceColumns"
                        row-key="userId"
                        :loading="svcLoading"
                        empty-message="No service users yet. Service users are used for API access and automation."
                    >
                        <template #cell-role="{row}">
                            <span class="usr-status usr-status--active">{{ row.role || 'No built-in role' }}</span>
                        </template>
                        <template #cell-tokenCount="{row}">
                            <span class="svc-token-count">{{ row.tokenCount ?? 0 }}</span>
                        </template>
                        <template #cell-signIn>
                            <span class="usr-status usr-status--inactive">{{ SERVICE_USER_CREDENTIAL_MODE.signInLabel }}</span>
                        </template>
                        <template #cell-actions="{row}">
                            <button type="button" class="user-action-btn" title="Copy username" @click="copySvcUsername(row.userName)"><i class="fas fa-copy" /></button>
                            <button v-if="canManageServiceUsers" type="button" class="user-action-btn" title="Assignments" @click="openEditServiceUser(row, 'assignments')"><i class="fas fa-id-badge" /></button>
                            <button v-if="canManagePats" type="button" class="user-action-btn" title="Generate PAT" @click="openCreatePAT(row)"><i class="fas fa-key" /></button>
                            <button v-if="canManagePats && row.tokenCount > 0" type="button" class="user-action-btn" title="View tokens" @click="openListPATs(row)"><i class="fas fa-list" /></button>
                            <button v-if="canManageServiceUsers" type="button" class="user-action-btn user-action-btn--danger" :title="`Delete ${row.name || row.userName} (permanent)`" :aria-label="`Delete ${row.name || row.userName}`" @click="confirmDeleteServiceUser(row)">
                                <i class="fas fa-trash" />
                            </button>
                        </template>
                    </DataList>
                    </template>
                </div>
            </div>
        </template>
        </ErrorBoundary>
    </div>

    <template #modals>
        <UsersCreateServiceUserModal
            :visible="svcCreateVisible"
            :creating="svcCreating"
            :form="svcForm"
            :errors="svcErrors"
            :persona-options="servicePersonaOptions"
            :persona-key="svcPersonaKey"
            :result="svcResult"
            @close="closeCreateServiceUserModal"
            @submit="createServiceUser"
            @copy="copyServiceKey"
            @download="downloadServiceKey"
            @done="finishServiceUser"
        />

        <UsersCreatePatModal
            v-model:name="patName"
            v-model:expiration="patExpirationDays"
            v-model:scoped="patScoped"
            v-model:scope-all="patScopeAll"
            v-model:purpose="patPurpose"
            v-model:scope-picked="patScopePicked"
            :visible="patCreateVisible"
            :creating="patCreating"
            :target-identity="patTargetIdentity"
            :active-mode="activePatMode"
            :preview="scopedPatPreview"
            :result="patResult"
            @close="patCreateVisible = false"
            @submit="generatePAT"
            @copy="copyPAT"
            @done="onCreatePatDone"
        />

        <UsersListPatsModal
            :visible="patListVisible"
            :loading="patListLoading"
            :busy="patBusy"
            :can-manage="canManagePats"
            :target-identity="patTargetIdentity"
            :zitadel-pats="patList"
            :scoped-pats="scopedPatList"
            :rotated="rotatedPats"
            @close="patListVisible = false"
            @bulk-rotate="bulkRotatePATs"
            @rotate="rotatePAT"
            @revoke-zitadel="revokePATConfirm"
            @revoke-scoped="revokeScopedPATConfirm"
        />

        <ConfirmationModal ref="patRevokeRef">
            <template #title><h3>Revoke this token?</h3></template>
            <template #subText><p class="svc-pat-hint">This cannot be undone. Any system using this token will lose access.</p></template>
        </ConfirmationModal>

        <UsersCreateUserModal
            :visible="showCreateModal"
            :creating="creatingUser"
            :form="createForm"
            :errors="createErrors"
            :password-rules="passwordRules"
            v-model:picture-file="createPictureFile"
            @close="showCreateModal = false"
            @submit="handleCreateUser"
            @validate="validateField"
        />

        <UsersEditUserModal
            v-model:tab="editUserTab"
            :target-id="editUserTargetId"
            :target-label="editUserTargetLabel"
            :target-user-name="editUserTargetUserName"
            :target-active="editUserTargetActive"
            :is-service-user="editUserIsServiceUser"
            :saving="editUserSaving"
            :form="editUserForm"
            @close="closeEditUser"
            @save-profile="saveEditUserProfile"
            @reset-password="editUserResetPassword"
            @toggle-active="editUserToggleActive"
        />

        <!-- Password Reset Confirmation -->
        <ConfirmationModal ref="confirmResetRef">
            <template #title>
                <h3>Send password reset email to {{ resetTargetLabel }}?</h3>
            </template>
        </ConfirmationModal>

        <!-- Delete User Confirmation — destructive, admin action. -->
        <ConfirmationModal ref="confirmDeleteRef">
            <template #title>
                <h3>Permanently delete {{ deleteTargetLabel }}?</h3>
            </template>
            <p>
                This removes the Zitadel account immediately and cannot be
                undone. Use Deactivate if you might restore the user later.
            </p>
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
    ref,
    watch
} from 'vue';
import Button from '@/components/core/Button.vue';
import DataList, {type DataColumn} from '@/components/core/DataList.vue';
import ErrorBoundary from '@/components/core/ErrorBoundary.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import Spinner from '@/components/core/Spinner.vue';
// Value import (not `import type`) so the template's <ConfirmationModal>
// resolves to the actual component at runtime — otherwise the ref binds
// to an unknown HTML element and storeAction() throws.
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import UsersCreatePatModal, {
    type CreatedPat
} from '@/components/pages/users/UsersCreatePatModal.vue';
import UsersCreateServiceUserModal, {
    type ServiceRoleGroup,
    type ServiceUserCreatedKey
} from '@/components/pages/users/UsersCreateServiceUserModal.vue';
import UsersCreateUserModal, {
    type CreateUserField,
    type CreateUserForm
} from '@/components/pages/users/UsersCreateUserModal.vue';
import UsersEditUserModal, {
    type EditUserTab
} from '@/components/pages/users/UsersEditUserModal.vue';
import UsersListPatsModal, {
    type ZitadelPatRow
} from '@/components/pages/users/UsersListPatsModal.vue';
import {ZITADEL_PASSWORD_MIN_LENGTH} from '@/constants';
import apiClient from '@/helpers/axios';
import {profilePictureFormData} from '@/helpers/profilePictureUpload';
import {useRpcPermissions} from '@/helpers/rpcPermissions';
import type {ScopeSelection} from '@/helpers/scopeDimensions';
import {
    buildPatCreatePlan,
    type PickedScopedPatBoundary
} from '@/helpers/scopedPatCreate';
import {
    buildServiceUserCreatePayload,
    serviceUserAccessReady
} from '@/helpers/serviceUserCreate';
import {
    SERVICE_USER_CREDENTIAL_MODE,
    SERVICE_USER_TOKEN_MODEL,
    serviceUserIdentityLabel
} from '@/helpers/serviceUserCredentialMode';
import {
    isLikelyEmail,
    isPasswordValidOrEmpty,
    passwordRulesFor
} from '@/helpers/zitadelPasswordRules';
import {useAuthStore} from '@/stores/auth';
import {usePersonasStore} from '@/stores/personas';
import {useToastStore} from '@/stores/toast';
import {useUsersStore, type ZitadelUser } from '@/stores/users';
import {createUploadTicket} from '@/tools/uploadTickets';
import {sendRPC} from '@/tools/websocket';
import type {RouteTab} from '@/types/page-template';

import '@/styles/device-page.css';

const tabs = inject<ComputedRef<RouteTab[]>>(
    'settingsTabs',
    computed(() => [])
);

interface ServiceUser {
    userId: string;
    userName: string;
    name: string;
    description?: string;
    role?: string;
    tokenCount: number;
}

const humanColumns: DataColumn<ZitadelUser>[] = [
    {
        key: 'displayName',
        label: 'Name',
        role: 'primary',
        accessor: (u) => u.displayName || u.userName
    },
    {
        key: 'email',
        label: 'Email',
        role: 'secondary',
        accessor: (u) => u.email || '—'
    },
    {key: 'userName', label: 'Username', role: 'meta'},
    {key: 'status', label: 'Status', role: 'status', align: 'center'},
    {key: 'actions', label: '', role: 'action', align: 'right'}
];

const serviceColumns: DataColumn<ServiceUser>[] = [
    {key: 'name', label: 'Name', role: 'primary'},
    {key: 'userName', label: 'Username', role: 'secondary'},
    {key: 'role', label: 'Role', role: 'meta'},
    {key: 'signIn', label: 'Sign-in', role: 'status', align: 'center'},
    {key: 'tokenCount', label: 'Tokens', role: 'meta', align: 'center'},
    {key: 'actions', label: '', role: 'action', align: 'right'}
];

const store = useUsersStore();
const authStore = useAuthStore();
const toastStore = useToastStore();
const personasStore = usePersonasStore();

// Dev deployments run without a Zitadel PAT, so the management UI is normally
// hidden. In dev we still render it for visual review — RPCs won't persist.
const devPreview = computed(() => authStore.devMode);
const usersView = ref<'human' | 'service'>('human');
const userSearch = ref('');
type CreateUserParams = Parameters<
    (typeof store)['createUserWithPermissions']
>[0];

const filteredUsers = computed(() => {
    if (!userSearch.value) return store.users;
    const q = userSearch.value.toLowerCase();
    return store.users.filter(
        (u) =>
            u.displayName?.toLowerCase().includes(q) ||
            u.userName?.toLowerCase().includes(q) ||
            u.email?.toLowerCase().includes(q)
    );
});

const filteredServiceUsers = computed(() => {
    if (!userSearch.value) return serviceUsers.value;
    const q = userSearch.value.toLowerCase();
    return serviceUsers.value.filter(
        (u) =>
            u.name.toLowerCase().includes(q) ||
            u.userName.toLowerCase().includes(q)
    );
});

// Create user state
const showCreateModal = ref(false);
const creatingUser = ref(false);
const CREATE_USER_FIELDS: CreateUserField[] = [
    'email',
    'userName',
    'firstName',
    'lastName',
    'password'
];

const createForm = reactive<CreateUserForm>({
    email: '',
    userName: '',
    firstName: '',
    lastName: '',
    password: '',
    passwordChangeRequired: true,
    groupIds: [],
    assignments: []
});
const createPictureFile = ref<File | null>(null);

// Inline validation
const createErrors = reactive<Record<CreateUserField, string>>({
    email: '',
    userName: '',
    firstName: '',
    lastName: '',
    password: ''
});

const FIELD_LABELS: Record<CreateUserField, string> = {
    email: 'Email',
    userName: 'Username',
    firstName: 'First name',
    lastName: 'Last name',
    password: 'Password'
};

const passwordRules = computed(() => passwordRulesFor(createForm.password));
const isCreatePasswordValid = computed(() =>
    isPasswordValidOrEmpty(createForm.password)
);

function validateField(field: CreateUserField) {
    const value = createForm[field].trim();
    if (field === 'password') {
        createErrors.password = isCreatePasswordValid.value
            ? ''
            : 'Password does not meet the policy requirements';
    } else if (!value) {
        createErrors[field] = `${FIELD_LABELS[field] ?? field} is required`;
    } else if (field === 'email' && !isLikelyEmail(value)) {
        createErrors[field] = 'Enter a valid email address';
    } else {
        createErrors[field] = '';
    }
}

function validateAllFields(): boolean {
    for (const field of CREATE_USER_FIELDS) {
        validateField(field);
    }
    return Object.values(createErrors).every((e) => !e);
}

function applyCreateErrorToFields(message: string) {
    if (!message) return;
    const passwordMatch = message.match(/Password must[^".}]*/i);
    if (passwordMatch) {
        createErrors.password = passwordMatch[0];
    }
}

onMounted(async () => {
    const available = await store.checkZitadelAvailable();
    if (available) {
        await store.fetchUsers();
    }
    void personasStore.fetchAll(true);
});

function isActive(user: ZitadelUser): boolean {
    return !user.state || user.state === 'USER_STATE_ACTIVE';
}

function openCreateModal() {
    createForm.email = '';
    createForm.userName = '';
    createForm.firstName = '';
    createForm.lastName = '';
    createForm.password = '';
    createForm.passwordChangeRequired = true;
    createForm.groupIds = [];
    createForm.assignments = [];
    createPictureFile.value = null;
    createErrors.email = '';
    createErrors.userName = '';
    createErrors.firstName = '';
    createErrors.lastName = '';
    createErrors.password = '';
    store.createError = '';
    showCreateModal.value = true;
}

async function handleCreateUser() {
    if (!validateAllFields()) return;
    creatingUser.value = true;
    try {
        const params: CreateUserParams = {
            email: createForm.email,
            userName: createForm.userName,
            firstName: createForm.firstName,
            lastName: createForm.lastName,
            groupIds: [...createForm.groupIds],
            assignments: [...createForm.assignments]
        };
        if (createForm.password) {
            params.password = createForm.password;
            params.passwordChangeRequired = createForm.passwordChangeRequired;
        }
        const result = await store.createUserWithPermissions(params);
        if (result) {
            await uploadCreatePicture(createForm.userName);
            showCreateModal.value = false;
        } else {
            applyCreateErrorToFields(store.createError);
        }
    } finally {
        creatingUser.value = false;
    }
}

// Avatar upload is a follow-up step: the upload ticket needs the user to exist.
async function uploadCreatePicture(username: string): Promise<void> {
    const file = createPictureFile.value;
    if (!file || !username) return;
    try {
        const ticket = await createUploadTicket(
            'User.ProfilePicture.CreateUploadTicket',
            {username}
        );
        const formData = profilePictureFormData({file, username, ticket});
        await apiClient.post('/media/uploadProfilePic', formData, {
            headers: {'Content-Type': 'multipart/form-data'}
        });
    } catch {
        toastStore.warning('User created, but the photo upload failed.');
    }
}

watch(
    () => createForm.password,
    () => {
        if (createForm.password || createErrors.password) {
            validateField('password');
        }
    }
);

// Password reset confirmation
type ConfirmationModalHandle = ComponentPublicInstance & {
    storeAction: (action: () => Promise<unknown>) => void;
};

const confirmResetRef = ref<ConfirmationModalHandle | null>(null);
const resetTargetLabel = ref('');

function confirmResetPassword(user: ZitadelUser) {
    resetTargetLabel.value = user.displayName || user.userName;
    confirmResetRef.value?.storeAction(() =>
        store.sendPasswordReset(user.userId)
    );
}

async function toggleActive(user: ZitadelUser) {
    if (isActive(user)) {
        await store.deactivateUser(user.userId);
    } else {
        await store.reactivateUser(user.userId);
    }
}

const confirmDeleteRef = ref<ConfirmationModalHandle | null>(null);
const deleteTargetLabel = ref('');

function confirmDeleteUser(user: ZitadelUser) {
    deleteTargetLabel.value = user.displayName || user.userName;
    confirmDeleteRef.value?.storeAction(() => store.deleteUser(user.userId));
}

function confirmDeleteServiceUser(row: ServiceUser) {
    deleteTargetLabel.value = row.name || row.userName;
    confirmDeleteRef.value?.storeAction(async () => {
        const ok = await store.deleteServiceUser(row.userId);
        if (ok) await loadServiceUsers();
        return ok;
    });
}

// Edit User modal state — store IDs, not objects
const editUserTab = ref<EditUserTab>('profile');
const editUserTargetId = ref<string | null>(null);
const editUserTargetLabel = ref('');
const editUserTargetUserName = ref('');
const editUserTargetActive = ref(false);
// Service users have no firstName/lastName/email — saving the Profile tab
// would overwrite those fields as empty strings in Zitadel. Track origin so
// the Profile tab and its save button are hidden for service-user rows.
const editUserIsServiceUser = ref(false);
const editUserForm = reactive({
    firstName: '',
    lastName: '',
    displayName: '',
    email: ''
});
const editUserSaving = ref(false);

function closeEditUser() {
    editUserTargetId.value = null;
    editUserTargetLabel.value = '';
    editUserTargetUserName.value = '';
    editUserTargetActive.value = false;
    editUserIsServiceUser.value = false;
    editUserSaving.value = false;
}

function openEditUser(user: ZitadelUser, defaultTab: EditUserTab = 'profile') {
    editUserTargetId.value = user.userId;
    editUserTargetLabel.value = user.displayName || user.userName;
    editUserTargetUserName.value = user.userName;
    editUserTargetActive.value = isActive(user);
    editUserIsServiceUser.value = false;
    editUserTab.value = defaultTab;
    editUserForm.firstName = user.firstName || '';
    editUserForm.lastName = user.lastName || '';
    editUserForm.displayName = user.displayName || '';
    editUserForm.email = user.email || '';
}

// Service users carry a narrower row shape than ZitadelUser; project up
// to match what the Edit-User modal reads (no email / firstName etc.).
function openEditServiceUser(
    row: ServiceUser,
    defaultTab: EditUserTab = 'assignments'
) {
    const tab =
        defaultTab === 'auth-methods' || defaultTab === 'sessions'
            ? 'assignments'
            : defaultTab;
    openEditUser(
        {
            userId: row.userId,
            userName: row.userName,
            displayName: row.name
        },
        tab
    );
    editUserIsServiceUser.value = true;
}

async function saveEditUserProfile() {
    if (!editUserTargetId.value) return;
    if (editUserIsServiceUser.value) return; // synthetic row, no real profile
    editUserSaving.value = true;
    try {
        const ok = await store.updateUser({
            userId: editUserTargetId.value,
            firstName: editUserForm.firstName,
            lastName: editUserForm.lastName,
            displayName: editUserForm.displayName,
            email: editUserForm.email
        });
        if (ok) {
            closeEditUser();
        }
    } finally {
        editUserSaving.value = false;
    }
}

function editUserResetPassword() {
    if (!editUserTargetId.value) return;
    resetTargetLabel.value = editUserTargetLabel.value;
    confirmResetRef.value?.storeAction(() =>
        store.sendPasswordReset(editUserTargetId.value!)
    );
}

async function editUserToggleActive() {
    if (!editUserTargetId.value) return;
    let ok: boolean;
    if (editUserTargetActive.value) {
        ok = await store.deactivateUser(editUserTargetId.value);
    } else {
        ok = await store.reactivateUser(editUserTargetId.value);
    }
    if (ok) {
        closeEditUser();
    }
}

// ════════════════════════════════════════════════════════
// SERVICE USERS & PAT MANAGEMENT
// ════════════════════════════════════════════════════════

const rpc = useRpcPermissions();
const canManageUsers = computed(() => rpc.canCall('User.CreateZitadelUser'));
const canManageServiceUsers = computed(() =>
    rpc.canCall('User.CreateServiceUser')
);
const canManagePats = computed(() => rpc.canCall('User.CreatePAT'));

const serviceUsers = ref<ServiceUser[]>([]);
const svcLoading = ref(false);
const svcCreateVisible = ref(false);
const svcCreating = ref(false);
const svcResult = ref<ServiceUserCreatedKey | null>(null);
const svcForm = reactive({
    userName: '',
    name: '',
    description: '',
    personaId: '',
    scopeAll: true,
    scope: {} as ScopeSelection,
    accessReason: '',
    accessExpiresDays: '365',
    keyName: '',
    expirationDays: '365'
});
const svcErrors = reactive({userName: '', name: ''});

// Starter-role picker — all personas, the same vocabulary as Edit → Assignments.
const servicePersonaOptions = computed<ServiceRoleGroup[]>(() => [
    {
        label: 'Roles',
        items: Object.values(personasStore.personas)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((p) => ({value: p.id, label: p.name}))
    }
]);

const svcPersonaKey = computed(
    () => personasStore.personas[svcForm.personaId]?.key
);

function openCreateServiceUserModal() {
    resetServiceUserCreateForm();
    svcResult.value = null;
    svcCreateVisible.value = true;
}

function closeCreateServiceUserModal() {
    svcCreateVisible.value = false;
    svcResult.value = null;
    resetServiceUserCreateForm();
}

// Reveal-screen actions.
function finishServiceUser() {
    svcCreateVisible.value = false;
    svcResult.value = null;
    resetServiceUserCreateForm();
}

async function copyServiceKey() {
    if (!svcResult.value) return;
    try {
        await navigator.clipboard.writeText(svcResult.value.token);
        toastStore.success('API key copied');
    } catch {
        toastStore.error('Could not copy — select and copy it manually');
    }
}

function downloadServiceKey() {
    if (!svcResult.value) return;
    const {userName, token, expirationDate} = svcResult.value;
    const lines = [`Service user: ${userName}`, `API key: ${token}`];
    if (expirationDate) lines.push(`Expires: ${expirationDate}`);
    const blob = new Blob([`${lines.join('\n')}\n`], {type: 'text/plain'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${userName}-api-key.txt`;
    link.click();
    URL.revokeObjectURL(url);
}

function resetServiceUserCreateForm() {
    svcForm.userName = '';
    svcForm.name = '';
    svcForm.description = '';
    svcForm.personaId = '';
    svcForm.scopeAll = true;
    svcForm.scope = {};
    svcForm.accessReason = '';
    svcForm.accessExpiresDays = '365';
    svcForm.keyName = '';
    svcForm.expirationDays = '365';
    svcErrors.userName = '';
    svcErrors.name = '';
}

async function loadServiceUsers() {
    // ListServiceUsers scopes to the caller; provider support sees all orgs.
    if (!canManageServiceUsers.value) {
        serviceUsers.value = [];
        return;
    }
    const epoch = serviceEpoch.value;
    svcLoading.value = true;
    try {
        const [zit, scoped] = await Promise.all([
            sendRPC<{items: any[]}>(
                'FLEET_MANAGER',
                'User.ListServiceUsers',
                {}
            ),
            // Scoped PATs are tenant-wide; aggregate active counts per user.
            sendRPC<{
                items: Array<{userId: string; revokedAt?: string | null}>;
            }>('FLEET_MANAGER', 'User.ListScopedPATs', {}).catch(() => ({
                items: []
            }))
        ]);
        if (epoch !== serviceEpoch.value) return; // demoted mid-flight
        const scopedCountByUser = new Map<string, number>();
        for (const p of scoped?.items ?? []) {
            if (p.revokedAt) continue;
            scopedCountByUser.set(
                p.userId,
                (scopedCountByUser.get(p.userId) ?? 0) + 1
            );
        }
        serviceUsers.value = (zit?.items ?? []).map((u: any) => ({
            userId: u.userId,
            userName: u.userName,
            name: u.name || u.userName,
            description: u.description,
            role: u.role,
            tokenCount:
                (u.tokenCount ?? 0) + (scopedCountByUser.get(u.userId) ?? 0)
        }));
    } catch {
        if (epoch === serviceEpoch.value) serviceUsers.value = [];
    } finally {
        if (epoch === serviceEpoch.value) svcLoading.value = false;
    }
}

async function createServiceUser() {
    svcErrors.userName = svcForm.userName.trim() ? '' : 'Username is required';
    svcErrors.name = svcForm.name.trim() ? '' : 'Name is required';
    if (svcErrors.userName || svcErrors.name) return;
    // A starter role is required; if scoped, at least one resource must be
    // picked; full admin/manager access also needs a reason.
    if (!serviceUserAccessReady(svcForm, svcPersonaKey.value)) {
        toastStore.error(
            'Finish the Access step — role, scope, and a reason for full access.'
        );
        return;
    }
    const epoch = serviceEpoch.value;
    const keyName = svcForm.keyName.trim();
    const keyExpiration = svcForm.expirationDays || '365';
    svcCreating.value = true;
    try {
        const result = await sendRPC<{
            userId: string;
            userName: string;
            role: string;
        }>(
            'FLEET_MANAGER',
            'User.CreateServiceUser',
            buildServiceUserCreatePayload(svcForm, svcPersonaKey.value)
        );
        if (epoch !== serviceEpoch.value) return; // demoted mid-flight

        // Mint the first key as part of creation. If it fails, the user still
        // exists — fall through to the key modal so it can be retried there.
        let key: CreatedPat | null = null;
        try {
            const plan = buildPatCreatePlan({
                userId: result.userId,
                expirationDaysText: keyExpiration,
                scoped: false,
                scopeAll: false,
                pickedScope: {},
                purpose: '',
                name: keyName
            });
            key = await sendRPC<CreatedPat>(
                'FLEET_MANAGER',
                plan.createMethod,
                plan.createParams
            );
        } catch (keyErr: any) {
            toastStore.warning(
                `Service user created, but key generation failed (${keyErr?.message ?? 'unknown'}). Generate one below.`
            );
        }
        if (epoch !== serviceEpoch.value) return;

        if (key) {
            // Reveal the key once, in place (phase 2). Show it before the list
            // refresh so the one-time secret never waits on anything else.
            toastStore.success(`Service user '${result.userName}' created`);
            svcResult.value = {
                userName: result.userName,
                token: key.token,
                name: key.name || keyName,
                expirationDate: key.expirationDate
            };
        } else {
            // User exists but the key failed — retry from the key modal.
            svcCreateVisible.value = false;
            patTargetUser.value = {
                userId: result.userId,
                userName: result.userName,
                name: svcForm.name.trim(),
                tokenCount: 0
            };
            patName.value = keyName;
            patExpirationDays.value = keyExpiration;
            patResult.value = null;
            patCreateVisible.value = true;
            resetServiceUserCreateForm();
        }
        // List refresh runs behind the modal; it self-handles its own errors.
        await loadServiceUsers();
    } catch (e: any) {
        toastStore.error(e?.message ?? 'Failed to create service user');
    } finally {
        if (epoch === serviceEpoch.value) svcCreating.value = false;
    }
}

// PAT management
const patCreateVisible = ref(false);
const patCreating = ref(false);
const patTargetUser = ref<ServiceUser | null>(null);
const patTargetIdentity = computed(() =>
    serviceUserIdentityLabel(patTargetUser.value)
);
const activePatMode = computed(() => {
    if (patScoped.value) {
        return {
            title: SERVICE_USER_TOKEN_MODEL.scopedTitle,
            description: SERVICE_USER_TOKEN_MODEL.scopedDescription
        };
    }
    return {
        title: SERVICE_USER_TOKEN_MODEL.zitadelTitle,
        description: SERVICE_USER_TOKEN_MODEL.zitadelDescription
    };
});
const patExpirationDays = ref('365');
const patName = ref('');
// FM scoped tokens are narrower credentials. Plain PATs stay Zitadel-issued.
const patScoped = ref(false);
const patScopeAll = ref(true);
const patPurpose = ref('');
type ScopedPatPreview = {
    usable: boolean;
    effectiveStatementCount: number;
    noAccessReason: string | null;
};
const patScopePicked = ref<PickedScopedPatBoundary>({});
const scopedPatPreview = ref<ScopedPatPreview | null>(null);
const patResult = ref<CreatedPat | null>(null);

const patListVisible = ref(false);
const patListLoading = ref(false);
const patList = ref<ZitadelPatRow[]>([]);
type ScopedPatRow = {
    tokenId: string;
    purpose?: string;
    boundaryScope?: Record<string, unknown>;
    expiresAt?: string;
    lastUsedAt?: string | null;
};
const scopedPatList = ref<ScopedPatRow[]>([]);

const patRevokeRef = ref<InstanceType<typeof ConfirmationModal>>();

function resetScopedPatFields() {
    patScoped.value = false;
    patScopeAll.value = true;
    patPurpose.value = '';
    patScopePicked.value = {};
    scopedPatPreview.value = null;
}

function openCreatePAT(svc: ServiceUser) {
    patTargetUser.value = svc;
    patResult.value = null;
    patName.value = '';
    patExpirationDays.value = '365';
    resetScopedPatFields();
    patCreateVisible.value = true;
}

async function generatePAT() {
    if (!patTargetUser.value) return;
    const epoch = serviceEpoch.value;
    patCreating.value = true;
    try {
        const plan = buildPatCreatePlan({
            userId: patTargetUser.value.userId,
            expirationDaysText: patExpirationDays.value,
            scoped: patScoped.value,
            scopeAll: patScopeAll.value,
            pickedScope: patScopePicked.value,
            purpose: patPurpose.value,
            name: patName.value
        });
        if (plan.kind === 'fm_scoped_pat') {
            const preview = await sendRPC<ScopedPatPreview>(
                'FLEET_MANAGER',
                plan.previewMethod,
                plan.previewParams
            );
            scopedPatPreview.value = preview;
            if (!preview.usable) {
                toastStore.error(
                    preview.noAccessReason ?? 'Scoped token would have no access'
                );
                return;
            }
        }
        const result = await sendRPC<{
            tokenId: string;
            token: string;
            expirationDate?: string;
            name?: string;
            keyHint?: string;
        }>('FLEET_MANAGER', plan.createMethod, plan.createParams);
        if (epoch !== serviceEpoch.value) return; // demoted mid-flight
        patResult.value = result;
        toastStore.success('Token generated — copy it now');
        await loadServiceUsers();
    } catch (e: any) {
        toastStore.error(e?.message ?? 'Failed to generate token');
    } finally {
        if (epoch === serviceEpoch.value) patCreating.value = false;
    }
}

function copySvcUsername(userName: string) {
    navigator.clipboard
        .writeText(userName)
        .then(() => toastStore.success('Username copied'))
        .catch(() => toastStore.error('Copy failed'));
}

function copyPAT() {
    if (!patResult.value) return;
    navigator.clipboard
        .writeText(patResult.value.token)
        .then(() => toastStore.success('Token copied'))
        .catch(() => toastStore.error('Copy failed'));
}

function onCreatePatDone() {
    patCreateVisible.value = false;
    patResult.value = null;
}

async function openListPATs(svc: ServiceUser) {
    const epoch = serviceEpoch.value;
    patTargetUser.value = svc;
    patListLoading.value = true;
    patListVisible.value = true;
    try {
        const [zit, scoped] = await Promise.all([
            sendRPC<{items: any[]}>('FLEET_MANAGER', 'User.ListPATs', {
                userId: svc.userId
            }).catch(() => ({items: []})),
            sendRPC<{items: any[]}>('FLEET_MANAGER', 'User.ListScopedPATs', {
                userId: svc.userId
            }).catch(() => ({items: []}))
        ]);
        if (epoch !== serviceEpoch.value) return; // demoted mid-flight
        patList.value = (zit?.items ?? []).map((t: any) => ({
            id: t.id || t.tokenId,
            expirationDate: t.expirationDate,
            name: t.name,
            keyHint: t.keyHint
        }));
        scopedPatList.value = (scoped?.items ?? []).map((t: any) => ({
            tokenId: t.tokenId,
            purpose: t.purpose,
            boundaryScope: t.boundaryScope,
            expiresAt: t.expiresAt,
            lastUsedAt: t.lastUsedAt
        }));
    } catch {
        if (epoch === serviceEpoch.value) {
            patList.value = [];
            scopedPatList.value = [];
        }
    } finally {
        if (epoch === serviceEpoch.value) patListLoading.value = false;
    }
}

function revokeScopedPATConfirm(tokenId: string) {
    if (!canManagePats.value) return;
    patRevokeRef.value?.storeAction(async () => {
        if (!patTargetUser.value) return;
        const epoch = serviceEpoch.value;
        try {
            await sendRPC('FLEET_MANAGER', 'User.RevokeScopedPAT', {tokenId});
            if (epoch !== serviceEpoch.value) return; // demoted mid-flight
            toastStore.success('Scoped token revoked');
            if (patTargetUser.value) await openListPATs(patTargetUser.value);
        } catch (e: any) {
            if (epoch !== serviceEpoch.value) return;
            toastStore.error(e?.message ?? 'Failed to revoke scoped token');
        }
    });
}

function revokePATConfirm(tokenId: string) {
    if (!canManagePats.value) return;
    patRevokeRef.value?.storeAction(async () => {
        if (!patTargetUser.value) return;
        const epoch = serviceEpoch.value;
        const target = patTargetUser.value;
        try {
            await sendRPC('FLEET_MANAGER', 'User.RevokePAT', {
                userId: target.userId,
                tokenId
            });
            if (epoch !== serviceEpoch.value) return;
            toastStore.success('Token revoked');
            if (patTargetUser.value) await openListPATs(patTargetUser.value);
            await loadServiceUsers();
        } catch (e: any) {
            if (epoch !== serviceEpoch.value) return;
            toastStore.error(e?.message ?? 'Failed to revoke token');
        }
    });
}

const patBusy = ref(false);
const rotatedPats = ref<
    Array<{tokenId: string; token: string; replacedTokenId: string}>
>([]);

// Bumped on every demotion. Service-user async actions snapshot this
// at entry; after await, a mismatch means demotion happened mid-flight
// and the continuation must drop its result instead of repopulating
// privileged state the watcher just cleared.
const serviceEpoch = ref(0);

// SoT for live-demotion cleanup. Loading flags reset too so a later
// re-promotion doesn't open the UI with stuck spinners from a fetch
// the epoch check bailed.
watch(canManageUsers, (now) => {
    if (now) return;
    serviceEpoch.value++;
    if (usersView.value === 'service') usersView.value = 'human';
    serviceUsers.value = [];
    svcCreateVisible.value = false;
    patCreateVisible.value = false;
    patListVisible.value = false;
    patResult.value = null;
    rotatedPats.value = [];
    patList.value = [];
    scopedPatList.value = [];
    patTargetUser.value = null;
    svcLoading.value = false;
    svcCreating.value = false;
    patCreating.value = false;
    patListLoading.value = false;
    patBusy.value = false;
    if (editUserIsServiceUser.value) closeEditUser();
});

async function rotatePAT(tokenId: string) {
    if (!patTargetUser.value || !canManagePats.value) return;
    const epoch = serviceEpoch.value;
    const target = patTargetUser.value;
    patBusy.value = true;
    try {
        const r = await sendRPC<{
            tokenId: string;
            token: string;
            replacedTokenId: string;
        }>('FLEET_MANAGER', 'User.RotatePAT', {
            userId: target.userId,
            tokenId
        });
        if (epoch !== serviceEpoch.value) return; // demoted mid-flight
        rotatedPats.value = [...rotatedPats.value, r];
        toastStore.success('Token rotated — copy the new value now');
        if (patTargetUser.value) await openListPATs(patTargetUser.value);
    } catch (e: any) {
        if (epoch !== serviceEpoch.value) return;
        toastStore.error(e?.message ?? 'Failed to rotate token');
    } finally {
        if (epoch === serviceEpoch.value) patBusy.value = false;
    }
}

async function bulkRotatePATs() {
    if (!patTargetUser.value || !canManagePats.value) return;
    const epoch = serviceEpoch.value;
    const target = patTargetUser.value;
    patBusy.value = true;
    try {
        const r = await sendRPC<{
            results: Array<{
                tokenId?: string;
                token?: string;
                replacedTokenId: string;
                ok: boolean;
                error?: string;
            }>;
        }>('FLEET_MANAGER', 'User.BulkRotatePATs', {
            userId: target.userId
        });
        if (epoch !== serviceEpoch.value) return; // demoted mid-flight
        const ok = (r.results ?? []).filter(
            (x) => x.ok && x.tokenId && x.token
        );
        rotatedPats.value = [
            ...rotatedPats.value,
            ...ok.map((x) => ({
                tokenId: x.tokenId as string,
                token: x.token as string,
                replacedTokenId: x.replacedTokenId
            }))
        ];
        const failed = (r.results ?? []).length - ok.length;
        if (failed > 0) {
            toastStore.warning(
                `${ok.length} rotated, ${failed} failed — see new tokens below`
            );
        } else {
            toastStore.success(`Rotated ${ok.length} token(s)`);
        }
        if (patTargetUser.value) await openListPATs(patTargetUser.value);
    } catch (e: any) {
        if (epoch !== serviceEpoch.value) return;
        toastStore.error(e?.message ?? 'Failed to bulk-rotate tokens');
    } finally {
        if (epoch === serviceEpoch.value) patBusy.value = false;
    }
}

watch(usersView, (v) => {
    userSearch.value = '';
    if (v === 'service' && serviceUsers.value.length === 0) loadServiceUsers();
});
onMounted(() => {
    if (store.zitadelAvailable && usersView.value === 'service')
        loadServiceUsers();
});
</script>

<style scoped>
.users-layout {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    padding-top: var(--gap-sm);
}

/* ── Warning banner ── */
.usr-warning {
    border: 1px solid var(--color-warning);
    border-radius: var(--radius-lg);
    background-color: var(--color-warning-subtle);
    padding: var(--gap-sm);
}
.usr-warning__header {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    color: var(--color-warning-text);
    font-weight: var(--font-semibold);
    font-size: var(--type-body);
}
.usr-warning__body {
    color: var(--color-warning-text);
    font-size: var(--type-body);
    margin-top: var(--gap-xs);
}
/* Dev-preview note — quieter than the warning, sits above the rendered UI. */
.usr-devnote {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    margin-bottom: var(--gap-sm);
    padding: var(--gap-xs) var(--gap-sm);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.usr-devnote i {
    color: var(--color-text-secondary);
}

/* ── Panel (consistent with other settings pages) ── */
.usr-panel {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface-1);
    overflow: hidden;
}
.usr-panel__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--gap-xs) var(--gap-sm);
    min-height: var(--touch-target-min);
    border-bottom: 1px solid var(--color-border-default);
    background-color: var(--color-surface-2);
}
.usr-panel__title {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.usr-panel__body {
    padding: 0;
}
.usr-panel__body--center {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--gap-lg) var(--gap-sm);
}

/* ── Table ── */
.usr-table {
    width: 100%;
    font-size: var(--type-body);
}
.usr-table__head-row {
    border-bottom: 1px solid var(--color-border-default);
}
.usr-table__th {
    text-align: left;
    padding: var(--gap-xs) var(--gap-sm);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    text-transform: none;
    letter-spacing: var(--tracking-wide);
    color: var(--color-text-tertiary);
}
.usr-table__th--center { text-align: center; }
.usr-table__th--right { text-align: right; }
.usr-table__row {
    border-bottom: 1px solid var(--color-border-default);
    transition: background-color var(--duration-fast) var(--ease-default);
}
.usr-table__row:last-child { border-bottom: none; }
.usr-table__row:hover { background-color: var(--color-surface-2); }
.usr-table__td {
    padding: var(--gap-xs) var(--gap-sm);
    color: var(--color-text-secondary);
}
.usr-table__td--name {
    font-weight: var(--font-medium);
    color: var(--color-text-primary);
}
.usr-table__td--email { color: var(--color-text-tertiary); }
.usr-table__td--username {
    font-family: var(--font-mono);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.usr-table__td--center { text-align: center; }
.usr-table__td--right { text-align: right; }
.usr-table__actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--gap-xs);
}
.usr-table__empty {
    padding: var(--gap-md) var(--gap-sm);
    text-align: center;
    color: var(--color-text-tertiary);
}
.usr-status {
    display: inline-block;
    padding: 1px var(--gap-xs);
    border-radius: var(--radius-full);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}
.usr-status--active {
    color: var(--color-success-text);
    background-color: var(--color-success-subtle);
}
.usr-status--inactive {
    color: var(--color-danger-text);
    background-color: var(--color-danger-subtle);
}

.user-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--gap-lg);
    height: var(--gap-lg);
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--type-body);
    font-family: inherit;
    color: var(--color-primary-text);
    background-color: transparent;
    cursor: pointer;
    transition: background-color var(--duration-fast), color var(--duration-fast);
}
.user-action-btn:hover {
    background-color: var(--color-primary-subtle);
}
.user-action-btn--warning {
    color: var(--color-warning-text);
}
.user-action-btn--warning:hover {
    background-color: var(--color-warning-subtle);
}
.user-action-btn--danger {
    color: var(--color-danger-text);
}
.user-action-btn--danger:hover {
    background-color: var(--color-danger-subtle);
}
.user-action-btn--success {
    color: var(--color-success-text);
}
.user-action-btn--success:hover {
    background-color: var(--color-success-subtle);
}

/* ── Edit User modal ── */
.edit-user-header {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
}
.edit-user-profile {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
}
.edit-user-profile__row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--gap-sm);
}
@media (max-width: 640px) {
    .edit-user-profile__row {
        grid-template-columns: 1fr;
    }
}
.edit-user-profile__readonly {
    display: flex;
    align-items: baseline;
    gap: var(--gap-xs);
    padding: var(--gap-xs);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
}
.edit-user-profile__readonly-value {
    font-family: var(--font-mono);
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}
.edit-user-profile__readonly-hint {
    font-size: var(--type-body);
    color: var(--color-text-quaternary);
}
.edit-user-status {
    flex-shrink: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    padding: 1px var(--gap-xs);
    border-radius: var(--radius-full);
}
.edit-user-status--active {
    color: var(--color-success-text);
    background-color: color-mix(in srgb, var(--color-success) 15%, transparent);
}
.edit-user-status--inactive {
    color: var(--color-danger-text);
    background-color: color-mix(in srgb, var(--color-danger) 15%, transparent);
}
.edit-user-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--gap-xs);
    padding: var(--gap-lg) 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.edit-user-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
}
.edit-user-footer__actions {
    display: flex;
    gap: var(--gap-xs);
}
.edit-user-footer__right {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
}
.edit-user-footer__saving {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}

/* ── Shared utility classes (replacing Tailwind) ── */
.usr-hint {
    color: var(--color-text-tertiary);
    margin-top: var(--gap-xs);
}
.usr-skeleton-list {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    padding: var(--gap-md) var(--gap-sm);
}
.usr-table-wrap {
    overflow-x: auto;
}
.usr-form {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
}
.usr-form__row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--gap-sm);
}
@media (max-width: 640px) {
    .usr-form__row,
    .usr-password-rules {
        grid-template-columns: 1fr;
    }
}
.usr-form__note {
    color: var(--color-text-quaternary);
    font-size: var(--type-body);
}
.usr-select {
    width: 100%;
    padding: var(--gap-xs) var(--gap-sm);
    background-color: var(--color-surface-3);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
}
.usr-select:focus {
    outline: none;
    border-color: var(--color-primary);
}
.usr-checkbox-label {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    cursor: pointer;
}
.usr-checkbox {
    border-radius: var(--radius-sm);
    background-color: var(--color-surface-3);
    border: 1px solid var(--color-border-strong);
}
.usr-checkbox:disabled {
    opacity: 0.75;
    cursor: not-allowed;
}
.usr-password-rules {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--gap-xs);
    margin-top: calc(var(--gap-sm) * -1);
    font-size: var(--type-body);
}
.usr-password-rules__item {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    min-width: 0;
    color: var(--color-text-tertiary);
}
.usr-password-rules__item i {
    width: 1rem;
    font-size: var(--type-card-footer);
}
.usr-password-rules__item--ok {
    color: var(--color-success-text);
}
.usr-password-rules__item--pending {
    color: var(--color-text-quaternary);
}
.usr-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--gap-xs);
}
.usr-loading {
    text-align: center;
    padding: var(--gap-lg) 0;
}
.usr-saving {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}

/* ── Users view toggle + search ── */
.usr-search { max-width: 240px; min-width: 140px; }

/* ── Service user / PAT ── */
.svc-token-count { font-size: var(--type-body); font-weight: var(--font-bold); color: var(--color-text-secondary); font-family: var(--font-mono); }
.svc-credential-mode {
    display: flex;
    align-items: flex-start;
    gap: var(--gap-xs);
    padding: var(--gap-xs);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
}
.svc-credential-mode span {
    display: flex;
    flex-direction: column;
    gap: var(--gap-2xs);
}
.svc-credential-mode small {
    color: var(--color-text-tertiary);
    font-size: var(--type-card-footer);
}
.svc-pat-hint { font-size: var(--type-body); color: var(--color-text-tertiary); }
.svc-token-model {
    display: flex;
    flex-direction: column;
    gap: var(--gap-2xs);
    padding: var(--gap-xs);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
}
.svc-token-model strong { color: var(--color-text-primary); }
.svc-token-model span { font-size: var(--type-body); color: var(--color-text-tertiary); }
.svc-pat-preview-result {
    display: flex;
    flex-direction: column;
    gap: var(--gap-2xs);
    padding: var(--gap-xs);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    font-size: var(--type-body);
}
.svc-pat-preview-result--ok {
    border-color: var(--color-success-text);
    color: var(--color-success-text);
}
.svc-pat-preview-result--warn {
    border-color: var(--color-warning-text);
    color: var(--color-warning-text);
}
.svc-pat-result { display: flex; flex-direction: column; gap: var(--gap-sm); margin-top: var(--gap-sm); }
.svc-pat-result__meta { font-size: var(--type-card-footer); color: var(--color-text-quaternary); font-family: var(--font-mono); }
.svc-pat-sections { display: flex; flex-direction: column; gap: var(--gap-sm); }
.svc-pat-list { display: flex; flex-direction: column; gap: var(--gap-xs); }
.svc-pat-item {
    display: flex; align-items: center; justify-content: space-between; gap: var(--gap-sm);
    padding: var(--gap-xs) var(--gap-sm); border-radius: var(--radius-md);
    background: var(--color-surface-1); border: 1px solid var(--color-border-default);
}
.svc-pat-item__info { display: flex; flex-direction: column; gap: var(--space-0-5); }
.svc-pat-item__id { font-family: var(--font-mono); font-size: var(--type-body); color: var(--color-text-primary); }
.svc-pat-item__exp { font-size: var(--type-card-footer); color: var(--color-text-quaternary); }
.svc-pat-item__actions { display: flex; gap: var(--space-2); }
.svc-pat-toolbar { display: flex; justify-content: flex-end; margin-bottom: var(--space-2); }
.svc-pat-rotated {
    margin-top: var(--space-3); padding: var(--space-3);
    border: 1px solid var(--color-warning); border-radius: var(--radius-sm);
    background: var(--color-warning-subtle);
}
.svc-pat-rotated__list { list-style: none; margin: var(--space-2) 0 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.svc-pat-rotated__row { display: flex; gap: var(--space-2); align-items: center; }
.svc-pat-rotated__replaced { font-size: var(--type-card-footer); color: var(--color-text-quaternary); flex: 0 0 220px; }
.svc-pat-rotated__token { font-family: var(--font-mono); background: var(--color-surface-2); padding: var(--space-px) var(--space-2); border-radius: var(--radius-sm); word-break: break-all; flex: 1; }
</style>

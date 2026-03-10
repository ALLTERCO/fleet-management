<template>
    <div class="space-y-4">
        <h2 class="sr-only">Users</h2>
        <!-- Zitadel unavailable banner -->
        <div v-if="store.zitadelAvailable === false" class="bg-[var(--color-warning-subtle)] border border-[var(--color-warning)] rounded-lg px-4 py-3">
            <div class="flex items-center gap-2">
                <i class="fas fa-exclamation-triangle text-[var(--color-warning-text)]" />
                <span class="text-[var(--color-warning-text)] font-medium">Zitadel Management API Not Available</span>
            </div>
            <p class="text-[var(--color-warning-text)] text-sm mt-1">
                The Zitadel Management PAT is not configured. User management requires a valid Personal Access Token.
                You can still use the permission config editor below to generate JSON manually.
            </p>
        </div>

        <!-- Fallback: standalone PermissionConfigEditor when Zitadel is unavailable -->
        <PermissionConfigEditor v-if="store.zitadelAvailable === false" />

        <!-- Loading state -->
        <BasicBlock v-if="store.zitadelAvailable === null" darker class="text-center py-8">
            <i class="fas fa-spinner fa-spin text-2xl text-[var(--color-text-disabled)]" />
            <p class="text-[var(--color-text-tertiary)] mt-2">Checking Zitadel availability...</p>
        </BasicBlock>

        <!-- User management (Zitadel available) -->
        <template v-if="store.zitadelAvailable">
            <BasicBlock darker title="Users">
                <div class="flex items-center justify-between mb-4">
                    <p class="text-[var(--color-text-tertiary)] text-sm">
                        Manage users and permissions for this organization.
                    </p>
                    <Button type="green" @click="openCreateModal">
                        <i class="fas fa-plus mr-2" /> Create User
                    </Button>
                </div>

                <div v-if="store.loading" class="space-y-3 py-4">
                    <Skeleton v-for="n in 5" :key="n" variant="row" />
                </div>

                <div v-else class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead>
                            <tr class="text-[var(--color-text-tertiary)] border-b border-[var(--color-border-default)]">
                                <th class="text-left py-2 px-3">Name</th>
                                <th class="text-left py-2 px-3">Email</th>
                                <th class="text-left py-2 px-3">Username</th>
                                <th class="text-center py-2 px-3">Status</th>
                                <th class="text-right py-2 px-3">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="user in store.users"
                                :key="user.userId"
                                class="border-b border-[var(--color-border-default)] hover:bg-[var(--color-surface-3)]"
                            >
                                <td class="py-2 px-3 text-white">{{ user.displayName || user.userName }}</td>
                                <td class="py-2 px-3 text-[var(--color-text-tertiary)]">{{ user.email || '—' }}</td>
                                <td class="py-2 px-3 text-[var(--color-text-disabled)] font-mono text-xs">{{ user.userName }}</td>
                                <td class="py-2 px-3 text-center">
                                    <span
                                        class="px-2 py-0.5 rounded text-xs font-medium"
                                        :class="isActive(user)
                                            ? 'bg-[var(--color-success-subtle)] text-[var(--color-success-text)]'
                                            : 'bg-[var(--color-danger-subtle)] text-[var(--color-danger-text)]'"
                                    >
                                        {{ isActive(user) ? 'Active' : 'Inactive' }}
                                    </span>
                                </td>
                                <td class="py-2 px-3 text-right">
                                    <div class="flex items-center justify-end gap-1">
                                        <button
                                            class="px-2 py-1 text-xs rounded bg-[var(--color-primary)]/50 text-[var(--color-primary-text)] hover:bg-[var(--color-primary)] transition-colors"
                                            title="Edit Permissions"
                                            @click="openPermissions(user)"
                                        >
                                            <i class="fas fa-pen-to-square" />
                                            <span class="hidden lg:inline ml-1">Edit</span>
                                        </button>
                                        <div class="relative" data-user-menu>
                                            <button
                                                class="user-overflow-trigger px-2 py-1 text-xs rounded transition-colors"
                                                :class="openMenuUserId === user.userId ? 'user-overflow-trigger--active' : ''"
                                                title="More actions"
                                                @click.stop="toggleUserMenu(user.userId)"
                                            >
                                                <i class="fas fa-ellipsis-vertical" />
                                            </button>
                                            <Transition name="menu-fade">
                                                <div
                                                    v-if="openMenuUserId === user.userId"
                                                    class="user-action-menu absolute right-0 top-full mt-1 rounded-lg shadow-lg py-1 min-w-[160px] z-[var(--z-dropdown)]"
                                                >
                                                    <button
                                                        class="user-action-item w-full text-left px-3 py-2 text-xs flex items-center gap-2"
                                                        @click="openPermissions(user); openMenuUserId = null"
                                                    >
                                                        <i class="fas fa-shield-alt text-[var(--color-primary-text)] w-4" />
                                                        Permissions
                                                    </button>
                                                    <button
                                                        class="user-action-item w-full text-left px-3 py-2 text-xs flex items-center gap-2"
                                                        @click="confirmResetPassword(user); openMenuUserId = null"
                                                    >
                                                        <i class="fas fa-key text-[var(--color-warning-text)] w-4" />
                                                        Reset Password
                                                    </button>
                                                    <div class="user-action-divider my-1 mx-2" />
                                                    <button
                                                        v-if="isActive(user)"
                                                        class="user-action-item user-action-item--danger w-full text-left px-3 py-2 text-xs flex items-center gap-2"
                                                        @click="toggleActive(user); openMenuUserId = null"
                                                    >
                                                        <i class="fas fa-user-slash w-4" />
                                                        Deactivate
                                                    </button>
                                                    <button
                                                        v-else
                                                        class="user-action-item w-full text-left px-3 py-2 text-xs flex items-center gap-2"
                                                        @click="toggleActive(user); openMenuUserId = null"
                                                    >
                                                        <i class="fas fa-user-check text-[var(--color-success-text)] w-4" />
                                                        Reactivate
                                                    </button>
                                                </div>
                                            </Transition>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                            <tr v-if="store.users.length === 0">
                                <td colspan="5" class="py-6 text-center text-[var(--color-text-disabled)]">
                                    No users found in this organization
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </BasicBlock>
        </template>

        <!-- Create User Modal -->
        <Modal :visible="showCreateModal" @close="showCreateModal = false">
            <template #title>Create User</template>
            <form class="space-y-4" @submit.prevent="handleCreateUser">
                <FormField label="Email" :error="createErrors.email">
                    <Input v-model="createForm.email" type="email" placeholder="user@example.com" @blur="validateField('email')" />
                </FormField>
                <FormField label="Username" :error="createErrors.userName">
                    <Input v-model="createForm.userName" placeholder="username" @blur="validateField('userName')" />
                </FormField>
                <div class="grid grid-cols-2 gap-3">
                    <FormField label="First Name" :error="createErrors.firstName">
                        <Input v-model="createForm.firstName" placeholder="First" @blur="validateField('firstName')" />
                    </FormField>
                    <FormField label="Last Name" :error="createErrors.lastName">
                        <Input v-model="createForm.lastName" placeholder="Last" @blur="validateField('lastName')" />
                    </FormField>
                </div>
                <FormField label="Initial Permissions">
                    <select
                        v-model="createForm.preset"
                        class="w-full px-3 py-2 bg-[var(--color-surface-3)] border border-[var(--color-border-strong)] rounded text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-primary)]"
                    >
                        <option v-for="opt in presetOptions" :key="opt" :value="opt">{{ opt }}</option>
                    </select>
                </FormField>
                <FormField label="Password" optional>
                    <Input v-model="createForm.password" type="password" placeholder="Leave empty for email setup" />
                </FormField>
                <label v-if="createForm.password" class="flex items-center gap-2 text-sm text-[var(--color-text-tertiary)] cursor-pointer">
                    <input v-model="createForm.passwordChangeRequired" type="checkbox" class="rounded bg-[var(--color-surface-3)] border-[var(--color-border-strong)]" />
                    Force password change on first login
                </label>
                <p class="text-[var(--color-text-disabled)] text-xs">
                    {{ createForm.password
                        ? 'User will be created with the specified password.'
                        : 'The user will receive an email to set their password via Zitadel.' }}
                    Permissions can be adjusted after creation.
                </p>
            </form>
            <template #footer>
                <div class="flex justify-end gap-2">
                    <Button type="white" @click="showCreateModal = false">Cancel</Button>
                    <Button type="blue" :disabled="creatingUser" @click="handleCreateUser">
                        {{ creatingUser ? 'Creating...' : 'Create' }}
                    </Button>
                </div>
            </template>
        </Modal>

        <!-- Edit Permissions Modal -->
        <Modal :visible="!!editingUser" wide @close="closePermissions">
            <template #title>
                Permissions — {{ editingUser?.displayName || editingUser?.userName }}
            </template>
            <div v-if="loadingPermissions" class="text-center py-8">
                <i class="fas fa-spinner fa-spin text-xl text-[var(--color-text-disabled)]" />
                <p class="text-[var(--color-text-tertiary)] mt-2">Loading permissions...</p>
            </div>
            <PermissionConfigEditor
                v-else
                :initial-config="editingPermissions ?? undefined"
                :direct-mode="true"
                @save="savePermissions"
            />
            <template v-if="savingPermissions" #footer>
                <div class="flex items-center gap-2 text-[var(--color-text-tertiary)] text-sm">
                    <i class="fas fa-spinner fa-spin" /> Saving...
                </div>
            </template>
        </Modal>
        <!-- Password Reset Confirmation -->
        <ConfirmationModal ref="confirmResetRef">
            <template #title>
                <h1>Send password reset email to {{ resetTargetUser?.displayName || resetTargetUser?.userName }}?</h1>
            </template>
        </ConfirmationModal>
    </div>
</template>

<script setup lang="ts">
import {onMounted, onUnmounted, reactive, ref} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import Button from '@/components/core/Button.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import Skeleton from '@/components/core/Skeleton.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import Modal from '@/components/modals/Modal.vue';
import PermissionConfigEditor from '@/components/PermissionConfigEditor.vue';
import {
    createAdminConfig,
    createInstallerConfig,
    createOperatorConfig,
    createViewerConfig,
    type FleetPermissionConfig
} from '@/helpers/sharedInfo';
import {useToastStore} from '@/stores/toast';
import {useUsersStore, type ZitadelUser} from '@/stores/users';

const store = useUsersStore();
const toastStore = useToastStore();

// Overflow menu state
const openMenuUserId = ref<string | null>(null);
function toggleUserMenu(userId: string) {
    openMenuUserId.value = openMenuUserId.value === userId ? null : userId;
}
function closeAllMenus(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('[data-user-menu]')) {
        openMenuUserId.value = null;
    }
}
onMounted(() => document.addEventListener('click', closeAllMenus));
onUnmounted(() => document.removeEventListener('click', closeAllMenus));

// Preset options for create modal
const presetOptions = ['Viewer', 'Operator', 'Installer', 'Admin', 'None'];

function presetToConfig(preset: string): FleetPermissionConfig | undefined {
    switch (preset) {
        case 'Viewer':
            return createViewerConfig();
        case 'Operator':
            return createOperatorConfig();
        case 'Installer':
            return createInstallerConfig();
        case 'Admin':
            return createAdminConfig();
        default:
            return undefined;
    }
}

// Create user state
const showCreateModal = ref(false);
const creatingUser = ref(false);
const createForm = reactive({
    email: '',
    userName: '',
    firstName: '',
    lastName: '',
    preset: 'Viewer',
    password: '',
    passwordChangeRequired: true
});

// Inline validation
const createErrors = reactive<Record<string, string>>({
    email: '',
    userName: '',
    firstName: '',
    lastName: ''
});

function validateField(field: string) {
    const value = (createForm as any)[field]?.trim();
    if (!value) {
        createErrors[field] =
            `${field === 'userName' ? 'Username' : field === 'firstName' ? 'First name' : field === 'lastName' ? 'Last name' : 'Email'} is required`;
    } else if (field === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        createErrors[field] = 'Enter a valid email address';
    } else {
        createErrors[field] = '';
    }
}

function validateAllFields(): boolean {
    for (const field of ['email', 'userName', 'firstName', 'lastName']) {
        validateField(field);
    }
    return Object.values(createErrors).every((e) => !e);
}

// Edit permissions state
const editingUser = ref<ZitadelUser | null>(null);
const editingPermissions = ref<FleetPermissionConfig | null>(null);
const loadingPermissions = ref(false);
const savingPermissions = ref(false);

onMounted(async () => {
    const available = await store.checkZitadelAvailable();
    if (available) {
        await store.fetchUsers();
    }
});

function isActive(user: ZitadelUser): boolean {
    return !user.state || user.state === 'USER_STATE_ACTIVE';
}

function openCreateModal() {
    createForm.email = '';
    createForm.userName = '';
    createForm.firstName = '';
    createForm.lastName = '';
    createForm.preset = 'Viewer';
    createForm.password = '';
    createForm.passwordChangeRequired = true;
    createErrors.email = '';
    createErrors.userName = '';
    createErrors.firstName = '';
    createErrors.lastName = '';
    showCreateModal.value = true;
}

async function handleCreateUser() {
    if (!validateAllFields()) return;
    creatingUser.value = true;
    try {
        const permConfig = presetToConfig(createForm.preset);
        const params: Record<string, any> = {
            email: createForm.email,
            userName: createForm.userName,
            firstName: createForm.firstName,
            lastName: createForm.lastName
        };
        if (createForm.password) {
            params.password = createForm.password;
            params.passwordChangeRequired = createForm.passwordChangeRequired;
        }
        const result = await store.createUserWithPermissions(
            params as any,
            permConfig
        );
        if (result) {
            showCreateModal.value = false;
            // Open permission editor so admin can review/tweak
            const newUser = store.users.find((u) => u.userId === result.userId);
            if (newUser) {
                openPermissions(newUser);
            }
        }
    } finally {
        creatingUser.value = false;
    }
}

async function openPermissions(user: ZitadelUser) {
    editingUser.value = user;
    editingPermissions.value = null;
    loadingPermissions.value = true;
    try {
        editingPermissions.value = await store.getUserPermissions(user.userId);
    } finally {
        loadingPermissions.value = false;
    }
}

function closePermissions() {
    editingUser.value = null;
    editingPermissions.value = null;
}

async function savePermissions(config: FleetPermissionConfig) {
    if (!editingUser.value) return;
    savingPermissions.value = true;
    try {
        const ok = await store.setUserPermissions(
            editingUser.value.userId,
            config
        );
        if (ok) {
            closePermissions();
        }
    } finally {
        savingPermissions.value = false;
    }
}

// Password reset confirmation
const confirmResetRef = ref<InstanceType<typeof ConfirmationModal>>();
const resetTargetUser = ref<ZitadelUser | null>(null);

function confirmResetPassword(user: ZitadelUser) {
    resetTargetUser.value = user;
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
</script>

<style scoped>
/* Overflow trigger */
.user-overflow-trigger {
    color: var(--color-text-secondary);
    background-color: transparent;
}
.user-overflow-trigger:hover,
.user-overflow-trigger--active {
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
}

/* Overflow menu */
.user-action-menu {
    background: var(--glass-bg);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: 1px solid var(--glass-border);
    box-shadow: var(--glass-shadow);
}
.user-action-item {
    color: var(--color-text-secondary);
}
.user-action-item:hover {
    background-color: var(--glass-hover);
    color: var(--color-text-primary);
}
.user-action-item--danger {
    color: var(--color-danger);
}
.user-action-item--danger:hover {
    background-color: var(--color-danger-subtle, rgba(239, 68, 68, 0.1));
    color: var(--color-danger);
}
.user-action-divider {
    border-top: 1px solid var(--color-border-default);
}

/* Menu fade transition */
.menu-fade-enter-active,
.menu-fade-leave-active {
    transition: opacity var(--duration-fast, 100ms) ease-out;
}
.menu-fade-enter-from,
.menu-fade-leave-to {
    opacity: 0;
}
</style>

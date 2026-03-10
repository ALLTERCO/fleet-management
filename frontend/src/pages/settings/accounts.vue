<template>
    <div class="space-y-4">
        <h2 class="sr-only">Accounts</h2>
        <!-- Dev Mode Notice -->
        <div class="bg-[var(--color-warning-subtle)] border border-[var(--color-warning)] rounded-lg px-4 py-3">
            <div class="flex items-center gap-2">
                <i class="fas fa-exclamation-triangle text-[var(--color-warning-text)]"></i>
                <span class="text-[var(--color-warning-text)] font-medium">DEV MODE</span>
            </div>
            <p class="text-[var(--color-warning-text)] text-sm mt-1">
                Local user management is enabled. Users are stored in the local database.
            </p>
        </div>

        <!-- Users List -->
        <BasicBlock darker title="Users">
            <div class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead>
                        <tr class="text-[var(--color-text-tertiary)] border-b border-[var(--color-border-default)]">
                            <th class="text-left py-2 px-3">Username</th>
                            <th class="text-left py-2 px-3">Email</th>
                            <th class="text-left py-2 px-3">Group</th>
                            <th class="text-center py-2 px-3">Enabled</th>
                            <th class="text-right py-2 px-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="user in users" :key="user.id" class="border-b border-[var(--color-border-default)] hover:bg-[var(--color-surface-3)]">
                            <td class="py-2 px-3 text-white">{{ user.name }}</td>
                            <td class="py-2 px-3 text-[var(--color-text-tertiary)]">{{ user.email || '-' }}</td>
                            <td class="py-2 px-3 text-[var(--color-text-tertiary)]">{{ user.user_group || '-' }}</td>
                            <td class="py-2 px-3 text-center">
                                <span :class="user.enabled ? 'text-[var(--color-success-text)]' : 'text-[var(--color-danger-text)]'">
                                    {{ user.enabled ? 'Yes' : 'No' }}
                                </span>
                            </td>
                            <td class="py-2 px-3 text-right">
                                <Button size="sm" type="blue" @click="editUser(user)">
                                    <i class="fas fa-edit"></i>
                                </Button>
                            </td>
                        </tr>
                        <tr v-if="users.length === 0">
                            <td colspan="5" class="py-4 text-center text-[var(--color-text-disabled)]">
                                No users found
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div class="mt-4">
                <Button type="green" @click="showCreateModal = true">
                    <i class="fas fa-plus mr-2"></i>
                    Create User
                </Button>
            </div>
        </BasicBlock>

        <!-- Create/Edit User Modal -->
        <div v-if="showCreateModal || editingUser" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div class="bg-[var(--color-surface-2)] rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
                <h3 class="text-lg font-semibold text-white mb-4">
                    {{ editingUser ? 'Edit User' : 'Create User' }}
                </h3>

                <form class="space-y-4" @submit.prevent="saveUser">
                    <div>
                        <label class="block text-sm text-[var(--color-text-tertiary)] mb-1">Username</label>
                        <Input v-model="userForm.name" placeholder="Username" :disabled="!!editingUser" />
                    </div>

                    <div>
                        <label class="block text-sm text-[var(--color-text-tertiary)] mb-1">Email</label>
                        <Input v-model="userForm.email" type="email" placeholder="Email" />
                    </div>

                    <div>
                        <label class="block text-sm text-[var(--color-text-tertiary)] mb-1">Full Name</label>
                        <Input v-model="userForm.fullName" placeholder="Full Name" />
                    </div>

                    <div>
                        <label class="block text-sm text-[var(--color-text-tertiary)] mb-1">Password</label>
                        <Input v-model="userForm.password" type="password" :placeholder="editingUser ? 'Leave blank to keep current' : 'Password'" />
                    </div>

                    <div>
                        <label class="block text-sm text-[var(--color-text-tertiary)] mb-1">Group</label>
                        <select v-model="userForm.group" class="w-full px-3 py-2 bg-[var(--color-surface-3)] border border-[var(--color-border-strong)] rounded text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-primary)]">
                            <option value="admin">Admin</option>
                            <option value="user">User</option>
                            <option value="viewer">Viewer</option>
                        </select>
                    </div>

                    <div class="flex items-center gap-2">
                        <input type="checkbox" v-model="userForm.enabled" id="user-enabled" class="rounded" />
                        <label for="user-enabled" class="text-[var(--color-text-secondary)]">Enabled</label>
                    </div>

                    <div>
                        <label class="block text-sm text-[var(--color-text-tertiary)] mb-1">
                            Permissions (JSON array)
                            <button aria-label="Toggle permissions help" @click="showPermissionsHelp = !showPermissionsHelp" class="ml-2 text-[var(--color-primary-text)] hover:text-[var(--color-primary-text)]">
                                <i class="fas fa-question-circle" aria-hidden="true"></i>
                            </button>
                        </label>
                        <div v-if="showPermissionsHelp" class="text-xs text-[var(--color-text-disabled)] mb-2 p-2 bg-[var(--color-surface-3)] rounded">
                            <p>Enter permissions as a JSON array, e.g.:</p>
                            <code class="block mt-1 text-[var(--color-success-text)]">["*"]</code>
                            <code class="block mt-1 text-[var(--color-success-text)]">["Device.*", "Entity.List"]</code>
                        </div>
                        <textarea
                            v-model="permissionsJson"
                            rows="4"
                            class="w-full px-3 py-2 bg-[var(--color-surface-3)] border border-[var(--color-border-strong)] rounded text-[var(--color-text-secondary)] font-mono text-sm focus:outline-none focus:border-[var(--color-primary)]"
                            placeholder='["*"]'
                        ></textarea>
                        <p v-if="permissionsError" class="text-[var(--color-danger-text)] text-xs mt-1">{{ permissionsError }}</p>
                    </div>
                </form>

                <div class="flex justify-end gap-2 mt-6">
                    <Button type="white" @click="closeModal">Cancel</Button>
                    <Button type="blue" @click="saveUser" :disabled="saving">
                        {{ saving ? 'Saving...' : 'Save' }}
                    </Button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, reactive, ref} from 'vue';
import {useRouter} from 'vue-router/auto';
import BasicBlock from '@/components/core/BasicBlock.vue';
import Button from '@/components/core/Button.vue';
import Input from '@/components/core/Input.vue';
import {useAuthStore} from '@/stores/auth';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';

interface User {
    id: number;
    name: string;
    email?: string;
    fullName?: string;
    user_group?: string;
    enabled: boolean;
    permissions?: string[];
}

const toastStore = useToastStore();
const authStore = useAuthStore();
const router = useRouter();

const users = ref<User[]>([]);
const showCreateModal = ref(false);
const editingUser = ref<User | null>(null);
const saving = ref(false);
const showPermissionsHelp = ref(false);
const permissionsJson = ref('["*"]');
const permissionsError = ref<string | null>(null);

const userForm = reactive({
    name: '',
    email: '',
    fullName: '',
    password: '',
    group: 'user',
    enabled: true
});

// Check if we're in dev mode
onMounted(async () => {
    if (!authStore.devMode) {
        toastStore.warning('This page is only available in dev mode');
        router.push('/settings');
        return;
    }
    await fetchUsers();
});

async function fetchUsers() {
    try {
        const result = await ws.sendRPC('FLEET_MANAGER', 'User.List', {});
        users.value = Array.isArray(result) ? result : [];
    } catch (error) {
        console.error('Failed to fetch users:', error);
        toastStore.error('Failed to fetch users');
    }
}

function editUser(user: User) {
    editingUser.value = user;
    userForm.name = user.name;
    userForm.email = user.email || '';
    userForm.fullName = user.fullName || '';
    userForm.password = '';
    userForm.group = user.user_group || 'user';
    userForm.enabled = user.enabled;

    // Parse permissions to JSON
    try {
        if (Array.isArray(user.permissions)) {
            permissionsJson.value = JSON.stringify(user.permissions, null, 2);
        } else if (typeof user.permissions === 'string') {
            permissionsJson.value = user.permissions;
        } else {
            permissionsJson.value = '["*"]';
        }
    } catch {
        permissionsJson.value = '["*"]';
    }
}

function closeModal() {
    showCreateModal.value = false;
    editingUser.value = null;
    userForm.name = '';
    userForm.email = '';
    userForm.fullName = '';
    userForm.password = '';
    userForm.group = 'user';
    userForm.enabled = true;
    permissionsJson.value = '["*"]';
    permissionsError.value = null;
}

async function saveUser() {
    // Validate permissions JSON
    let permissions: string[] = [];
    try {
        permissions = JSON.parse(permissionsJson.value);
        if (!Array.isArray(permissions)) {
            throw new Error('Permissions must be an array');
        }
        permissionsError.value = null;
    } catch (e: any) {
        permissionsError.value = 'Invalid JSON: ' + e.message;
        return;
    }

    saving.value = true;
    try {
        if (editingUser.value) {
            // Update existing user
            const updateData: any = {
                id: editingUser.value.id,
                email: userForm.email,
                fullName: userForm.fullName,
                group: userForm.group,
                enabled: userForm.enabled,
                permissions: permissions
            };

            // Only include password if provided
            if (userForm.password) {
                updateData.password = userForm.password;
            }

            await ws.sendRPC('FLEET_MANAGER', 'User.Update', updateData);
            toastStore.success('User updated successfully');
        } else {
            // Create new user
            if (!userForm.name || !userForm.password) {
                toastStore.error('Username and password are required');
                return;
            }

            await ws.sendRPC('FLEET_MANAGER', 'User.Create', {
                name: userForm.name,
                email: userForm.email,
                fullName: userForm.fullName,
                password: userForm.password,
                group: userForm.group,
                permissions: permissions
            });
            toastStore.success('User created successfully');
        }

        closeModal();
        await fetchUsers();
    } catch (error: any) {
        console.error('Failed to save user:', error);
        toastStore.error(error?.message || 'Failed to save user');
    } finally {
        saving.value = false;
    }
}
</script>

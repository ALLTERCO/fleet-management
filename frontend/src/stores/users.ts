import {defineStore} from 'pinia';
import {ref} from 'vue';
import type {FleetPermissionConfig} from '@/helpers/sharedInfo';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';

export interface ZitadelUser {
    userId: string;
    userName: string;
    email?: string;
    displayName?: string;
    state?: string;
}

export const useUsersStore = defineStore('users', () => {
    const users = ref<ZitadelUser[]>([]);
    const loading = ref(false);
    const zitadelAvailable = ref<boolean | null>(null);
    const toastStore = useToastStore();

    async function checkZitadelAvailable(): Promise<boolean> {
        try {
            const result = await sendRPC<{available: boolean}>(
                'FLEET_MANAGER',
                'User.ZitadelAvailable',
                {}
            );
            zitadelAvailable.value = result.available;
            return result.available;
        } catch {
            zitadelAvailable.value = false;
            return false;
        }
    }

    async function fetchUsers() {
        loading.value = true;
        try {
            const result = await sendRPC<ZitadelUser[]>(
                'FLEET_MANAGER',
                'User.ListZitadelUsers',
                {}
            );
            users.value = Array.isArray(result) ? result : [];
        } catch (error: any) {
            toastStore.error(
                'Failed to fetch users: ' + (error?.message || error)
            );
            users.value = [];
        } finally {
            loading.value = false;
        }
    }

    async function getUserPermissions(
        userId: string
    ): Promise<FleetPermissionConfig | null> {
        try {
            const result = await sendRPC<{
                userId: string;
                permissionConfig: FleetPermissionConfig | null;
            }>('FLEET_MANAGER', 'User.GetUserPermissions', {userId});
            return result.permissionConfig;
        } catch (error: any) {
            toastStore.error('Failed to get user permissions');
            return null;
        }
    }

    async function setUserPermissions(
        userId: string,
        config: FleetPermissionConfig
    ): Promise<boolean> {
        try {
            await sendRPC('FLEET_MANAGER', 'User.SetUserPermissions', {
                userId,
                permissionConfig: config
            });
            toastStore.success('Permissions saved successfully');
            return true;
        } catch (error: any) {
            toastStore.error(
                'Failed to save permissions: ' + (error?.message || error)
            );
            return false;
        }
    }

    async function createUser(params: {
        email: string;
        userName: string;
        firstName: string;
        lastName: string;
        displayName?: string;
        password?: string;
        passwordChangeRequired?: boolean;
    }): Promise<{userId: string} | null> {
        try {
            const result = await sendRPC<{userId: string}>(
                'FLEET_MANAGER',
                'User.CreateZitadelUser',
                params
            );
            toastStore.success('User created successfully');
            await fetchUsers();
            return result;
        } catch (error: any) {
            toastStore.error(
                'Failed to create user: ' + (error?.message || error)
            );
            return null;
        }
    }

    async function createUserWithPermissions(
        params: {
            email: string;
            userName: string;
            firstName: string;
            lastName: string;
            displayName?: string;
            password?: string;
            passwordChangeRequired?: boolean;
        },
        permissionConfig?: FleetPermissionConfig
    ): Promise<{userId: string} | null> {
        const result = await createUser(params);
        if (result && permissionConfig) {
            await setUserPermissions(result.userId, permissionConfig);
        }
        return result;
    }

    async function sendPasswordReset(userId: string): Promise<boolean> {
        try {
            await sendRPC('FLEET_MANAGER', 'User.SendPasswordReset', {userId});
            toastStore.success('Password reset email sent');
            return true;
        } catch (error: any) {
            toastStore.error('Failed to send password reset');
            return false;
        }
    }

    async function deactivateUser(userId: string): Promise<boolean> {
        try {
            await sendRPC('FLEET_MANAGER', 'User.DeactivateUser', {userId});
            toastStore.success('User deactivated');
            await fetchUsers();
            return true;
        } catch (error: any) {
            toastStore.error('Failed to deactivate user');
            return false;
        }
    }

    async function reactivateUser(userId: string): Promise<boolean> {
        try {
            await sendRPC('FLEET_MANAGER', 'User.ReactivateUser', {userId});
            toastStore.success('User reactivated');
            await fetchUsers();
            return true;
        } catch (error: any) {
            toastStore.error('Failed to reactivate user');
            return false;
        }
    }

    return {
        users,
        loading,
        zitadelAvailable,
        checkZitadelAvailable,
        fetchUsers,
        getUserPermissions,
        setUserPermissions,
        createUser,
        createUserWithPermissions,
        sendPasswordReset,
        deactivateUser,
        reactivateUser
    };
});

import type {EffectiveAccessRoleSummary, EffectiveShape} from '@api/authz';
import {defineStore} from 'pinia';
import {ref} from 'vue';
import {rpcErrorMessage} from '@/helpers/rpcError';
import type {ServiceUserAccessAssignment} from '@/helpers/serviceUserAccessPlan';
import {createRefreshCoordinator} from '@/stores/refreshCoordinator';
import {useToastStore} from '@/stores/toast';
import {debugWarn} from '@/tools/debug';
import {sendRPC} from '@/tools/websocket';

export type SimulateSource =
    | 'built-in-jwt'
    | 'group-assignment'
    | 'user-assignment';

export interface SimulateResult {
    decision: boolean;
    matchedBy: Array<{
        source: SimulateSource;
        persona: string;
        scope?: Record<string, unknown>;
    }>;
}

export interface EffectivePermissionsResult {
    userId: string;
    tenantId: string;
    shape: EffectiveShape;
    provenance: EffectiveAccessRoleSummary;
    hasCredentialBoundary: boolean;
    noAccessReason?: string;
}

export interface ZitadelUser {
    userId: string;
    userName: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    displayName?: string;
    state?: string;
}

export interface CreateUserResult {
    userId: string;
    permissionsSaved: boolean;
}

export const useUsersStore = defineStore('users', () => {
    const users = ref<ZitadelUser[]>([]);
    const loading = ref(false);
    const fetchError = ref('');
    const createError = ref('');
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
        } catch (error) {
            // Transport/RPC failure — assume available so we don't
            // show the misleading "PAT not configured" banner.
            // The actual user list fetch will show the real error.
            debugWarn('User.ZitadelAvailable failed', error);
            zitadelAvailable.value = true;
            return true;
        }
    }

    const usersRefresh = createRefreshCoordinator(refreshUsers);

    async function fetchUsers() {
        await usersRefresh.request();
    }

    async function refreshUsers(): Promise<void> {
        loading.value = true;
        fetchError.value = '';
        try {
            const result = await sendRPC<{items: ZitadelUser[]}>(
                'FLEET_MANAGER',
                'User.ListZitadelUsers',
                {}
            );
            const items =
                result?.items ?? (Array.isArray(result) ? result : []);
            users.value = items.filter((u) => !!u.userId);
        } catch (error: any) {
            fetchError.value = `Failed to fetch users: ${error?.message || error}`;
            toastStore.error(fetchError.value);
        } finally {
            loading.value = false;
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
        createError.value = '';
        try {
            const result = await sendRPC<{userId: string}>(
                'FLEET_MANAGER',
                'User.CreateZitadelUser',
                params
            );
            await fetchUsers();
            return result;
        } catch (error: any) {
            createError.value = error?.message || String(error);
            toastStore.error(`Failed to create user: ${createError.value}`);
            return null;
        }
    }

    // Create the Zitadel user, then grant optional group memberships and
    // persona assignments. CreateZitadelUser doesn't bundle them, so each is a
    // follow-up RPC; a failed grant warns but doesn't undo the created user.
    async function createUserWithPermissions(params: {
        email: string;
        userName: string;
        firstName: string;
        lastName: string;
        displayName?: string;
        password?: string;
        passwordChangeRequired?: boolean;
        groupIds?: string[];
        assignments?: ServiceUserAccessAssignment[];
    }): Promise<CreateUserResult | null> {
        const {groupIds = [], assignments = [], ...createParams} = params;
        const result = await createUser(createParams);
        if (!result) return null;
        const userId = result.userId;

        const failed: string[] = [];
        for (const id of groupIds) {
            try {
                await sendRPC('FLEET_MANAGER', 'user_group.addmembers', {
                    id,
                    userIds: [userId]
                });
            } catch (error) {
                debugWarn('user_group.addmembers failed', error);
                failed.push('a group');
            }
        }
        for (const assignment of assignments) {
            try {
                await sendRPC('FLEET_MANAGER', 'User.AttachCustomPersona', {
                    userId,
                    personaId: assignment.personaId,
                    scope: assignment.scope,
                    reason: assignment.reason ?? null,
                    // High-risk grants are rejected without an expiry.
                    expiresAt: assignment.expiresAt ?? null
                });
            } catch (error) {
                debugWarn('User.AttachCustomPersona failed', error);
                failed.push('a persona');
            }
        }

        if (failed.length > 0) {
            const what = [...new Set(failed)].join(' and ');
            toastStore.warning(
                `User created, but ${what} could not be assigned. Add it from Settings.`
            );
        } else {
            toastStore.success('User created');
        }
        return {userId, permissionsSaved: failed.length === 0};
    }

    async function refreshAfterMutation(action: string): Promise<boolean> {
        await fetchUsers();
        if (fetchError.value) {
            toastStore.warning(
                `${action}, but the user list failed to refresh`
            );
            return false;
        }
        toastStore.success(action);
        return true;
    }

    async function updateUser(params: {
        userId: string;
        firstName?: string;
        lastName?: string;
        displayName?: string;
        email?: string;
    }): Promise<boolean> {
        if (!params.userId) {
            toastStore.error('Cannot update user: no user selected');
            return false;
        }
        try {
            await sendRPC('FLEET_MANAGER', 'User.UpdateZitadelUser', params);
            return await refreshAfterMutation('User updated successfully');
        } catch (error: any) {
            toastStore.error(
                `Failed to update user: ${error?.message || error}`
            );
            return false;
        }
    }

    async function sendPasswordReset(userId: string): Promise<boolean> {
        if (!userId) {
            toastStore.error('Cannot reset password: no user selected');
            return false;
        }
        try {
            await sendRPC('FLEET_MANAGER', 'User.SendPasswordReset', {userId});
            toastStore.success('Password reset email sent');
            return true;
        } catch (error: unknown) {
            toastStore.error(
                `Failed to send password reset: ${rpcErrorMessage(error)}`
            );
            return false;
        }
    }

    async function deactivateUser(userId: string): Promise<boolean> {
        if (!userId) {
            toastStore.error('Cannot deactivate user: no user selected');
            return false;
        }
        try {
            await sendRPC('FLEET_MANAGER', 'User.DeactivateUser', {userId});
            return await refreshAfterMutation('User deactivated');
        } catch (error: unknown) {
            toastStore.error(
                `Failed to deactivate user: ${rpcErrorMessage(error)}`
            );
            return false;
        }
    }

    async function reactivateUser(userId: string): Promise<boolean> {
        if (!userId) {
            toastStore.error('Cannot reactivate user: no user selected');
            return false;
        }
        try {
            await sendRPC('FLEET_MANAGER', 'User.ReactivateUser', {userId});
            return await refreshAfterMutation('User reactivated');
        } catch (error: unknown) {
            toastStore.error(
                `Failed to reactivate user: ${rpcErrorMessage(error)}`
            );
            return false;
        }
    }

    // Hard delete. Caller-side guard belongs in the UI (confirmation modal).
    // Backend gate: admin + target's home org === sender's org.
    async function deleteUser(userId: string): Promise<boolean> {
        if (!userId) {
            toastStore.error('Cannot delete user: no user selected');
            return false;
        }
        try {
            await sendRPC('FLEET_MANAGER', 'User.DeleteZitadelUser', {userId});
            return await refreshAfterMutation('User deleted');
        } catch (error: unknown) {
            toastStore.error(
                `Failed to delete user: ${rpcErrorMessage(error)}`
            );
            return false;
        }
    }

    async function deleteServiceUser(userId: string): Promise<boolean> {
        if (!userId) {
            toastStore.error('Cannot delete service user: no user selected');
            return false;
        }
        try {
            await sendRPC('FLEET_MANAGER', 'User.DeleteServiceUser', {userId});
            toastStore.success('Service user deleted');
            return true;
        } catch (error: unknown) {
            toastStore.error(
                `Failed to delete service user: ${rpcErrorMessage(error)}`
            );
            return false;
        }
    }

    async function getEffectivePermissions(
        userId: string
    ): Promise<EffectivePermissionsResult | null> {
        try {
            return await sendRPC<EffectivePermissionsResult>(
                'FLEET_MANAGER',
                'User.GetEffectivePermissionsV2',
                {userId}
            );
        } catch (error: any) {
            toastStore.error(
                `Failed to load effective permissions: ${error?.message || error}`
            );
            return null;
        }
    }

    async function simulatePermission(params: {
        userId: string;
        action: string;
        resourceType: string;
        resourceId?: string | number;
        builtInRoles?: string[];
    }): Promise<SimulateResult | null> {
        try {
            return await sendRPC<SimulateResult>(
                'FLEET_MANAGER',
                'User.SimulateV2',
                params
            );
        } catch (error: any) {
            toastStore.error(`Simulation failed: ${error?.message || error}`);
            return null;
        }
    }

    return {
        users,
        loading,
        fetchError,
        createError,
        zitadelAvailable,
        checkZitadelAvailable,
        fetchUsers,
        createUser,
        createUserWithPermissions,
        updateUser,
        sendPasswordReset,
        deactivateUser,
        reactivateUser,
        deleteUser,
        deleteServiceUser,
        getEffectivePermissions,
        simulatePermission
    };
});

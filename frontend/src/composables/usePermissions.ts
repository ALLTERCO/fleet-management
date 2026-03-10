import {computed} from 'vue';
import {useAuthStore} from '@/stores/auth';

/**
 * Composable for checking user permissions in components.
 * Use this to conditionally show/hide or enable/disable UI elements based on role.
 */
export function usePermissions() {
    const authStore = useAuthStore();

    /**
     * Whether the user can perform write operations (create, update, delete, etc.)
     */
    const canWrite = computed(() => authStore.canWrite);

    /**
     * Whether the user is in read-only mode (viewer role)
     */
    const isReadOnly = computed(() => authStore.isReadOnly);

    /**
     * Whether the user is an admin
     */
    const isAdmin = computed(() => authStore.isAdmin);

    /**
     * Whether the user is a viewer
     */
    const isViewer = computed(() => authStore.isViewer);

    /**
     * The user's role
     */
    const role = computed(() => authStore.role);

    /**
     * Whether permissions have been loaded from the backend
     */
    const permissionsLoaded = computed(() => authStore.permissionsLoaded);

    /**
     * Check if a specific action is allowed.
     * Write actions require canWrite, read actions are always allowed.
     */
    function canPerform(
        action: 'read' | 'write' | 'create' | 'update' | 'delete' | 'execute'
    ): boolean {
        if (action === 'read') {
            return true;
        }
        return authStore.canWrite;
    }

    /**
     * Returns props to disable a button/input if user is read-only.
     * Usage: <Button v-bind="writeProps">Save</Button>
     */
    const writeProps = computed(() => ({
        disabled: !canWrite.value,
        title: !canWrite.value
            ? 'You do not have permission to perform this action'
            : undefined
    }));

    /**
     * Returns true if an element should be hidden for read-only users.
     * Usage: <Button v-if="!hideForViewer">Delete</Button>
     */
    const hideForViewer = computed(() => authStore.isViewer);

    return {
        canWrite,
        isReadOnly,
        isAdmin,
        isViewer,
        role,
        permissionsLoaded,
        canPerform,
        writeProps,
        hideForViewer
    };
}

export default usePermissions;

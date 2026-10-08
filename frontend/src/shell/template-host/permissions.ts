import type {ComponentName} from '@api/permissions';
import {computed} from 'vue';
import {useAuthStore} from '@/stores/auth';

type HostPermissionOperation =
    | 'create'
    | 'read'
    | 'update'
    | 'delete'
    | 'execute';

function splitAction(
    action: string,
    fallbackOperation?: HostPermissionOperation
): {component: ComponentName; operation: HostPermissionOperation} | null {
    if (fallbackOperation) {
        return {
            component: action as ComponentName,
            operation: fallbackOperation
        };
    }

    const [component, operation] = action.split(':');
    if (!component || !operation) return null;
    return {
        component: component as ComponentName,
        operation: operation as HostPermissionOperation
    };
}

export function usePermissions() {
    const auth = useAuthStore();

    function can(
        action: string,
        operation?: HostPermissionOperation,
        itemId?: string | number
    ): boolean {
        const parsed = splitAction(action, operation);
        if (!parsed) return auth.isAdmin;
        const componentName = parsed.component;
        if (itemId != null) {
            return auth.canPerformComponent(
                componentName,
                parsed.operation,
                itemId
            );
        }
        return auth.hasComponentPermission(componentName, parsed.operation);
    }

    // The backend unions a Zitadel role (scope.all) with scoped assignments.
    // For "which sites is this person responsible for" the explicit scope is
    // the answer, so a scoped Allow wins over an unscoped one. Location ids
    // arrive already expanded to every descendant, so a template can match a
    // child site without knowing the tree.
    function aggregateScopedIds(field: 'device_group_ids' | 'location_ids'): {
        ids: number[];
        unlimited: boolean;
    } {
        if (auth.isAdmin) return {ids: [], unlimited: true};
        const shape =
            (auth as any).effectiveShape?.value ?? (auth as any).effectiveShape;
        if (!shape || !Array.isArray(shape.statements)) {
            return {ids: [], unlimited: false};
        }
        const scopedIds = new Set<number>();
        let hasUnscopedAllow = false;
        for (const s of shape.statements) {
            if (s.effect !== 'Allow') continue;
            const ids = s.scope?.[field];
            if (Array.isArray(ids) && ids.length > 0) {
                for (const id of ids) scopedIds.add(Number(id));
            } else if (s.scope?.all) {
                hasUnscopedAllow = true;
            }
        }
        if (scopedIds.size > 0) return {ids: [...scopedIds], unlimited: false};
        return {ids: [], unlimited: hasUnscopedAllow};
    }

    return computed(() => {
        const groups = aggregateScopedIds('device_group_ids');
        const locations = aggregateScopedIds('location_ids');
        return {
            isAdmin: auth.isAdmin,
            isViewer: auth.isViewer,
            roles: auth.roles,
            can,
            scopedGroupIds: groups.ids,
            scopedGroupsUnlimited: groups.unlimited,
            scopedLocationIds: locations.ids,
            scopedLocationsUnlimited: locations.unlimited
        };
    });
}

export const permissions = {
    use: usePermissions
};

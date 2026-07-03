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

    /**
     * Aggregate device_group_ids across every Allow statement in the
     * user's effective permissions shape. This is the canonical "which
     * showrooms can this user see" list for templates that render groups
     * (supermarket, sportsdealership, etc.).
     *
     * Why expose this directly: scopeIncludesItem in stores/auth.ts only
     * scope-matches 'devices' / 'locations' / 'dashboards' / 'plugins'.
     * For 'groups' it returns false unless scope.all — because the
     * scope.device_group_ids field is designed to filter DEVICES that
     * live in those groups, not the groups themselves. Templates that
     * render groups as user-facing entities (showrooms, stores, sites)
     * need a direct list. Admins get an empty array here but should also
     * receive an `unlimited: true` signal.
     */
    function aggregateScopedGroupIds(): {ids: number[]; unlimited: boolean} {
        if (auth.isAdmin) return {ids: [], unlimited: true};
        const shape =
            (auth as any).effectiveShape?.value ?? (auth as any).effectiveShape;
        if (!shape || !Array.isArray(shape.statements)) {
            return {ids: [], unlimited: false};
        }
        // Two passes — narrowing semantics:
        //   1. Collect every device_group_ids list from Allow statements.
        //   2. Also note if any Allow has scope.all.
        //
        // FM's union semantics give a user with [Zitadel viewer role +
        // custom scoped assignment] both Allow statements:
        //   A: Allow read on group, scope.all=true      (from Zitadel role)
        //   B: Allow read on group, scope.device_group_ids=[6,7]  (custom)
        //
        // A naive union → unlimited (user sees everything), which defeats
        // the whole point of attaching the scoped custom persona.
        //
        // Our narrowing rule: if the user has at least one explicitly-
        // scoped Allow on group/device, treat that as the authoritative
        // group scope and IGNORE the scope.all signal. Admin users
        // bypass this entirely. Production deployments that want the
        // pure-union behaviour can grant admin (or no Zitadel role at all).
        const scopedIds = new Set<number>();
        let hasUnscopedAllow = false;
        for (const s of shape.statements) {
            if (s.effect !== 'Allow') continue;
            if (
                Array.isArray(s.scope?.device_group_ids) &&
                s.scope.device_group_ids.length > 0
            ) {
                for (const id of s.scope.device_group_ids) {
                    scopedIds.add(Number(id));
                }
            } else if (s.scope?.all) {
                hasUnscopedAllow = true;
            }
        }
        if (scopedIds.size > 0) {
            // Explicit scope wins — narrows even when an unscoped role
            // grant is also present.
            return {ids: [...scopedIds], unlimited: false};
        }
        return {ids: [], unlimited: hasUnscopedAllow};
    }

    return computed(() => {
        const scoped = aggregateScopedGroupIds();
        return {
            isAdmin: auth.isAdmin,
            can,
            /** Group IDs this user is scoped to (from their assignments). */
            scopedGroupIds: scoped.ids,
            /** True iff user has unscoped access (admin or scope.all). */
            scopedGroupsUnlimited: scoped.unlimited
        };
    });
}

export const permissions = {
    use: usePermissions
};

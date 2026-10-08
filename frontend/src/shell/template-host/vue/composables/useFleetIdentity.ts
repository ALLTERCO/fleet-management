// Identity from the runtime store React also reads. The host builds that store
// from Fleet's own user computed, so this is a source change, not a shape one.

import {type ComputedRef, computed, type Ref} from 'vue';
import type {FleetSessionIdentity} from '../../core/session';
import type {FleetUser} from '../../core/types';
import {useExternalStore} from '../external-store';
import {useFleetRuntime} from '../provider';

// Signed out is a state, not a missing user, so the ref is never null.
const SIGNED_OUT: FleetUser = {
    isAdmin: false,
    isViewer: false,
    roles: [],
    loggedIn: false
};

export function useCurrentUser(): ComputedRef<FleetUser> {
    const user = useExternalStore(useFleetRuntime().fleet.currentUser);
    return computed(() => user.value ?? SIGNED_OUT);
}

/**
 * Who the data on screen belongs to: the signed-in user and the tenant it was
 * loaded for. This is the read path for `organizationId` — a template that
 * digs a tenant out of a profile load gets whichever load answered last, and
 * keeps showing it across a tenant switch.
 *
 * Either field is null until the host resolves it; null is "not yet known",
 * never "none".
 */
export function useSession(): Readonly<Ref<FleetSessionIdentity>> {
    return useExternalStore(useFleetRuntime().session);
}

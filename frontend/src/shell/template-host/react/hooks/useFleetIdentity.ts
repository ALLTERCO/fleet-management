// Identity and authority hooks. Both read the host-owned external stores; the
// React binding never asks the backend who the user is.

import type {FleetPermissions, FleetUser} from '../../core/types';
import {useFleet} from '../FleetProvider';
import {useFleetStore} from './useFleetStore';

export function useCurrentUser(): FleetUser | null {
    return useFleetStore(useFleet().currentUser);
}

export function usePermissions(): FleetPermissions {
    return useFleetStore(useFleet().permissions);
}

/** Whether the UI offers the action. The backend still authorizes it. */
export function useCan(
    action: string,
    operation?: Parameters<FleetPermissions['can']>[1],
    itemId?: Parameters<FleetPermissions['can']>[2]
): boolean {
    return usePermissions().can(action, operation, itemId);
}

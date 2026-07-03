import {
    canCrossOrganizationBoundary,
    canPerformComponentOperation,
    isComponentPermissionAllowed
} from '../../modules/authz/evaluator';
import type CommandSender from '../CommandSender';

export function canReadWaitingRoom(sender: CommandSender): boolean {
    return allows(sender, 'read');
}

export function canAcceptPending(sender: CommandSender): boolean {
    return allows(sender, 'create') || allows(sender, 'update');
}

export function canRejectPending(sender: CommandSender): boolean {
    return allows(sender, 'delete') || allows(sender, 'update');
}

export function canQuarantinePending(sender: CommandSender): boolean {
    return canCrossOrganizationBoundary(sender);
}

type WaitingRoomOperation = 'create' | 'read' | 'update' | 'delete';

function allows(
    sender: CommandSender,
    operation: WaitingRoomOperation
): boolean {
    return isComponentPermissionAllowed(
        canPerformComponentOperation(sender, 'waiting_room', operation)
    );
}

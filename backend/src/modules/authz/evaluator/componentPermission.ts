import type CommandSender from '../../../model/CommandSender';
import type {ComponentName, CrudOperation} from '../../../model/permissions';
import {authzAction} from '../actionMap';
import type {AuthzDecision, AuthzRequest, ResourceId} from '../contracts';
import {resourceTypeForComponent} from './AuthzEvaluator';
import {
    canPerform,
    canPerformAsync,
    requirePermission,
    requirePermissionAsync
} from './requirePermission';

export function authzRequestForComponent(
    component: ComponentName,
    operation: CrudOperation,
    itemId?: ResourceId
): AuthzRequest {
    return {
        action: authzAction(component, operation),
        resource: {
            type: resourceTypeForComponent(component),
            ...(itemId !== undefined ? {id: itemId} : {})
        }
    };
}

export function canPerformComponentOperation(
    sender: CommandSender | undefined,
    component: ComponentName,
    operation: CrudOperation,
    itemId?: ResourceId
): AuthzDecision {
    return canPerform(
        sender,
        authzRequestForComponent(component, operation, itemId)
    );
}

export function canPerformComponentOperationAsync(
    sender: CommandSender | undefined,
    component: ComponentName,
    operation: CrudOperation,
    itemId?: ResourceId
): Promise<AuthzDecision> {
    return canPerformAsync(
        sender,
        authzRequestForComponent(component, operation, itemId)
    );
}

export function requireComponentPermission(
    sender: CommandSender | undefined,
    component: ComponentName,
    operation: CrudOperation,
    itemId?: ResourceId
): AuthzDecision {
    return requirePermission(
        sender,
        authzRequestForComponent(component, operation, itemId)
    );
}

export async function requireComponentPermissionAsync(
    sender: CommandSender | undefined,
    component: ComponentName,
    operation: CrudOperation,
    itemId?: ResourceId
): Promise<AuthzDecision> {
    return requirePermissionAsync(
        sender,
        authzRequestForComponent(component, operation, itemId)
    );
}

export function isComponentPermissionAllowed(decision: AuthzDecision): boolean {
    return decision.allowed;
}

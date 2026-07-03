import {getLogger} from 'log4js';
import type CommandSender from '../../../model/CommandSender';
import {
    type ComponentName,
    CRUD_OPERATIONS,
    type CrudOperation
} from '../../../model/permissions';
import {AUTHZ_RESOURCE_BY_COMPONENT} from '../../../types/api/authzCatalog';
import {authzResourceType} from '../actionMap';
import type {AuthzDecision, AuthzRequest} from '../contracts';
import {createDefaultResourceResolver} from '../resources/DefaultResourceResolver';
import type {ResourceResolver} from '../resources/ResourceResolver';

const COMPONENT_BY_RESOURCE = buildComponentByResource();
const logger = getLogger('authz');

interface ResolvedAuthzCommand {
    component: ComponentName;
    operation: CrudOperation;
}

type AuthzResolution =
    | {
          sender: CommandSender;
          command: ResolvedAuthzCommand;
      }
    | {
          denied: AuthzDecision;
      };

type ResourceResolution =
    | {
          ok: true;
          resource: AuthzRequest['resource'];
      }
    | {
          ok: false;
      };

export class AuthzEvaluator {
    private readonly resourceResolver: ResourceResolver;

    constructor(resourceResolver?: ResourceResolver) {
        this.resourceResolver =
            resourceResolver ?? createDefaultResourceResolver();
    }

    canPerform(
        sender: CommandSender | undefined,
        request: AuthzRequest
    ): AuthzDecision {
        const resolution = resolveAuthzCommand(sender, request);
        if ('denied' in resolution) return resolution.denied;
        const {component, operation} = resolution.command;
        const allowed = resolution.sender.evaluateComponentPermission({
            component,
            operation,
            itemId: request.resource.id
        });
        return decisionFromAllowed(request, allowed);
    }

    async canPerformAsync(
        sender: CommandSender | undefined,
        request: AuthzRequest
    ): Promise<AuthzDecision> {
        const resourceResolution = await this.resolveResource(request.resource);
        if (!resourceResolution.ok) {
            return deny(request, 'resource_resolution_failed');
        }
        const resolvedRequest = {
            ...request,
            resource: resourceResolution.resource
        };
        const resolution = resolveAuthzCommand(sender, resolvedRequest);
        if ('denied' in resolution) return resolution.denied;
        const {component, operation} = resolution.command;
        const allowed =
            await resolution.sender.evaluateComponentPermissionAsync({
                component,
                operation,
                itemId: resolvedRequest.resource.id
            });
        return decisionFromAllowed(resolvedRequest, allowed);
    }

    private async resolveResource(
        resource: AuthzRequest['resource']
    ): Promise<ResourceResolution> {
        try {
            return {
                ok: true,
                resource: await this.resourceResolver.resolve(resource)
            };
        } catch (error) {
            logger.debug('Resource resolution failed: %s', errorMessage(error));
            return {ok: false};
        }
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function resolveAuthzCommand(
    sender: CommandSender | undefined,
    request: AuthzRequest
): AuthzResolution {
    if (!sender) return {denied: deny(request, 'missing_sender')};
    const resource = request.resource;
    if (!resource?.type) return {denied: deny(request, 'missing_resource')};

    const component = componentForResourceType(resource.type);
    if (!component) return {denied: deny(request, 'unsupported_resource')};

    const operation = operationForAction(resource.type, request.action);
    if (!operation) return {denied: deny(request, 'unsupported_action')};

    return {sender, command: {component, operation}};
}

function decisionFromAllowed(
    request: AuthzRequest,
    allowed: boolean
): AuthzDecision {
    return {
        allowed,
        reason: allowed ? 'allowed' : 'denied',
        action: request.action,
        resource: request.resource,
        explanation: allowed
            ? 'Permission allowed by current effective access.'
            : 'Permission denied by current effective access.'
    };
}

export function componentForResourceType(
    resourceType: string
): ComponentName | undefined {
    return COMPONENT_BY_RESOURCE.get(resourceType);
}

export function operationForAction(
    resourceType: string,
    action: string
): CrudOperation | undefined {
    const [actionResourceType, verb, extra] = action.split(':');
    if (extra !== undefined) return undefined;
    if (actionResourceType !== resourceType) return undefined;
    if (verb === 'write') return 'update';
    return isCrudOperation(verb) ? verb : undefined;
}

function buildComponentByResource(): Map<string, ComponentName> {
    const out = new Map<string, ComponentName>();
    for (const [component, resourceType] of Object.entries(
        AUTHZ_RESOURCE_BY_COMPONENT
    )) {
        out.set(resourceType, component as ComponentName);
    }
    return out;
}

export function resourceTypeForComponent(component: ComponentName): string {
    return authzResourceType(component);
}

function isCrudOperation(value: string | undefined): value is CrudOperation {
    return CRUD_OPERATIONS.includes(value as CrudOperation);
}

function deny(
    request: AuthzRequest,
    reason: AuthzDecision['reason']
): AuthzDecision {
    return {
        allowed: false,
        reason,
        action: request.action,
        resource: request.resource,
        explanation: denyExplanation(reason)
    };
}

function denyExplanation(reason: AuthzDecision['reason']): string {
    switch (reason) {
        case 'missing_sender':
            return 'No authenticated caller was available.';
        case 'missing_resource':
            return 'No resource was provided for the authorization check.';
        case 'resource_resolution_failed':
            return 'Resource facts could not be resolved.';
        case 'unsupported_resource':
            return 'Resource type is not mapped to a Fleet Manager component.';
        case 'unsupported_action':
            return 'Action is not supported for this resource type.';
        default:
            return 'Permission denied by current effective access.';
    }
}

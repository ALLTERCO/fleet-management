import type CommandSender from '../../../model/CommandSender';
import {
    COMPONENT_DEFINITIONS,
    COMPONENT_ORDER,
    type ComponentCapabilityMap,
    type ComponentName,
    type CrudOperation,
    type UiCapabilities
} from '../../../types/api/permissions';
import {canPerformComponentOperation} from './componentPermission';

export function resolveUiCapabilities(
    sender: CommandSender | undefined
): UiCapabilities {
    return {components: resolveComponentCapabilities(sender)};
}

function resolveComponentCapabilities(
    sender: CommandSender | undefined
): ComponentCapabilityMap {
    const capabilities = {} as ComponentCapabilityMap;
    for (const component of COMPONENT_ORDER) {
        capabilities[component] = resolveOperations(sender, component);
    }
    return capabilities;
}

function resolveOperations(
    sender: CommandSender | undefined,
    component: ComponentName
): Partial<Record<CrudOperation, boolean>> {
    const operations: Partial<Record<CrudOperation, boolean>> = {};
    for (const operation of COMPONENT_DEFINITIONS[component]
        .availableOperations) {
        operations[operation] = canPerformOperation(
            sender,
            component,
            operation
        );
    }
    return operations;
}

function canPerformOperation(
    sender: CommandSender | undefined,
    component: ComponentName,
    operation: CrudOperation
): boolean {
    return canPerformComponentOperation(sender, component, operation).allowed;
}

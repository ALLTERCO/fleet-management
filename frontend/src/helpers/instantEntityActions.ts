import {entityCommandFeedbackMode} from './entityCommandCatalog';

export function isInstantEntityAction(
    entityType: string,
    action: string
): boolean {
    return entityCommandFeedbackMode(entityType, action) === 'instant';
}

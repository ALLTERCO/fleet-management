import type {ModuleStatus} from './types';

/**
 * Keep module-local status vocabularies from leaking into the topology API.
 *
 * Stats getters may omit status, which historically means healthy. `ok` is a
 * common local success alias. Any other non-canonical value is conservatively
 * reported as unknown instead of inventing a severity mapping.
 */
export function normalizeModuleStatus(status: unknown): ModuleStatus {
    switch (status) {
        case undefined:
        case 'ok':
        case 'healthy':
            return 'healthy';
        case 'warning':
        case 'critical':
        case 'unknown':
            return status;
        default:
            return 'unknown';
    }
}

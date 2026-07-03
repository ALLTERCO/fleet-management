// Shared RPC-param validators for user submodules.

import RpcError from '../../rpc/RpcError';
import {zitadelService} from '../zitadel';

export function requireString(name: string, value: unknown): void {
    if (typeof value !== 'string' || value.length === 0) {
        throw RpcError.InvalidParams(`${name} is required`);
    }
}

// Security-critical gate. Several callers (e.g. PAT creation, assignments)
// rely on this throwing when Zitadel is unreachable, because the in-process
// tenant-membership / role checks fail-open under DEV_MODE. Do NOT relax
// this for dev — relax at the specific call site instead (see
// listZitadelUsers for the pattern).
export function ensureZitadelManagement(): void {
    if (!zitadelService.isManagementApiAvailable()) {
        throw RpcError.InvalidParams('Zitadel Management API not available');
    }
}

// Fully-qualified-method helpers. Thin bindings over the core RPC access.

import {hostRpcAccess} from './api';

export function hostRpc<TResult = unknown>(
    method: string,
    params: object = {}
): Promise<TResult> {
    return hostRpcAccess.rpc<TResult>(method, params);
}

export function hostListAll<T>(
    method: string,
    params: object = {},
    pageSize?: number
): Promise<T[]> {
    return hostRpcAccess.rpcListAll<T>(method, params, pageSize);
}

export function useTemplateRpc<T = unknown>(
    method: string,
    params: Record<string, unknown> = {}
): Promise<T> {
    return hostRpc<T>(method, params);
}

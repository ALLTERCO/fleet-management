import {call, listAll} from './api';

export function hostRpc<TResult = unknown>(
    method: string,
    params: object = {}
): Promise<TResult> {
    const [namespace, ...methodPath] = method.split('.');
    if (!namespace || methodPath.length === 0) {
        throw new Error(`Invalid host RPC method: ${method}`);
    }
    return call<TResult>(namespace, methodPath, params);
}

export async function hostListAll<T>(
    method: string,
    params: object = {},
    pageSize?: number
): Promise<T[]> {
    const [namespace, ...methodPath] = method.split('.');
    if (!namespace || methodPath.length === 0) {
        throw new Error(`Invalid host list method: ${method}`);
    }
    return listAll<T>(namespace, methodPath, params, pageSize);
}

export function useTemplateRpc<T = unknown>(
    method: string,
    params: Record<string, unknown> = {}
): Promise<T> {
    return hostRpc<T>(method, params);
}

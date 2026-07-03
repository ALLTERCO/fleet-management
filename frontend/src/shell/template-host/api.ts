import {sendRPC} from '@/tools/websocket';
import type {HostPagedEnvelope} from './types';

const DEFAULT_PAGE_SIZE = 1000;

export type HostApiMethod = <
    TResult = unknown,
    TParams extends object = Record<string, unknown>
>(
    params?: TParams
) => Promise<TResult>;

export type HostApiNode = HostApiMethod & {
    readonly [key: string]: HostApiNode;
};

function normalizeSegment(segment: string): string {
    return segment.trim().toLowerCase();
}

export function toRpcMethod(namespace: string, methodPath: readonly string[]) {
    return [namespace, ...methodPath].map(normalizeSegment).join('.');
}

export function call<TResult = unknown>(
    namespace: string,
    methodPath: string | readonly string[],
    params: object = {}
): Promise<TResult> {
    const path =
        typeof methodPath === 'string' ? methodPath.split('.') : methodPath;
    return sendRPC<TResult>(
        'FLEET_MANAGER',
        toRpcMethod(namespace, path),
        params
    );
}

export async function listAll<T>(
    namespace: string,
    methodPath: string | readonly string[],
    params: object = {},
    pageSize = DEFAULT_PAGE_SIZE
): Promise<T[]> {
    const all: T[] = [];
    let offset = 0;
    while (true) {
        const page = await call<HostPagedEnvelope<T>>(namespace, methodPath, {
            ...params,
            limit: pageSize,
            offset
        });
        const items = page.items ?? [];
        all.push(...items);
        if (!page.has_more || items.length < pageSize) break;
        offset += pageSize;
    }
    return all;
}

function createApiNode(path: readonly string[]): HostApiNode {
    const target = ((params?: object) => {
        const [namespace, ...methodPath] = path;
        if (!namespace || methodPath.length === 0) {
            throw new Error('Host API call requires namespace and method');
        }
        return call(namespace, methodPath, params ?? {});
    }) as HostApiNode;

    return new Proxy(target, {
        get(target, prop, receiver) {
            if (typeof prop !== 'string') return undefined;
            if (prop === 'then') return undefined;
            if (prop in target) return Reflect.get(target, prop, receiver);
            return createApiNode([...path, prop]);
        }
    });
}

export const api = createApiNode([]);

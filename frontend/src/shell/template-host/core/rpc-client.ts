// Method normalization and the property-access RPC proxy, over an injected
// transport.

import {toFleetSdkError} from './errors';
import type {FleetRpcTransport} from './transport';

export type HostApiMethod = <
    TResult = unknown,
    TParams extends object = Record<string, unknown>
>(
    params?: TParams
) => Promise<TResult>;

export type HostApiNode = HostApiMethod & {
    readonly [key: string]: HostApiNode;
};

export type RpcCaller = <TResult = unknown>(
    namespace: string,
    methodPath: string | readonly string[],
    params?: object
) => Promise<TResult>;

function normalizeSegment(segment: string): string {
    return segment.trim().toLowerCase();
}

export function toRpcMethod(
    namespace: string,
    methodPath: readonly string[]
): string {
    return [namespace, ...methodPath].map(normalizeSegment).join('.');
}

function toSegments(methodPath: string | readonly string[]): readonly string[] {
    return typeof methodPath === 'string' ? methodPath.split('.') : methodPath;
}

/** Splits a fully-qualified method such as `alert.instance.ack`. */
export function splitMethod(method: string): [string, string[]] {
    const [namespace, ...path] = method.split('.');
    if (!namespace || path.length === 0) {
        throw new Error(`Invalid host RPC method: ${method}`);
    }
    return [namespace, path];
}

// Every SDK path (api proxy, call, rpc, listAll, the domains) funnels through
// here, so this is the one place a wire rejection becomes the SDK error
// shape. A template never sees the raw `{code: 1001, ...}` object.
export function createRpcCaller(transport: FleetRpcTransport): RpcCaller {
    return function call<TResult = unknown>(
        namespace: string,
        methodPath: string | readonly string[],
        params: object = {}
    ): Promise<TResult> {
        return transport
            .call<TResult>(
                toRpcMethod(namespace, toSegments(methodPath)),
                params
            )
            .catch((cause: unknown) => {
                throw toFleetSdkError(cause);
            });
    };
}

export function createApiProxy(transport: FleetRpcTransport): HostApiNode {
    const call = createRpcCaller(transport);

    function createNode(path: readonly string[]): HostApiNode {
        const target = ((params?: object) => {
            const [namespace, ...methodPath] = path;
            if (!namespace || methodPath.length === 0) {
                throw new Error('Host API call requires namespace and method');
            }
            return call(namespace, methodPath, params ?? {});
        }) as HostApiNode;

        return new Proxy(target, {
            get(node, prop, receiver) {
                if (typeof prop !== 'string') return undefined;
                // Denying `then` keeps `await api.device` from hanging on a
                // node the runtime would otherwise treat as a thenable.
                if (prop === 'then') return undefined;
                if (prop in node) return Reflect.get(node, prop, receiver);
                return createNode([...path, prop]);
            }
        });
    }

    return createNode([]);
}

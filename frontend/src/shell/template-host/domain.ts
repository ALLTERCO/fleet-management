import {api, call, type HostApiNode, listAll} from './api';
import type {HostMethod, HostParams, HostResult} from './generated/contract';

type NamespaceMethod<TNamespace extends string> = Extract<
    HostMethod,
    `${TNamespace}.${string}`
>;

export type HostDomainApi = HostApiNode & {
    call: <TResult = unknown>(
        methodPath: string | readonly string[],
        params?: object
    ) => Promise<TResult>;
    listAll: <TItem = unknown>(
        methodPath: string | readonly string[],
        params?: object,
        pageSize?: number
    ) => Promise<TItem[]>;
    describe: () => Promise<unknown>;
};

export type TypedHostDomainApi<TNamespace extends string> = HostDomainApi & {
    callTyped: <TMethod extends NamespaceMethod<TNamespace>>(
        method: TMethod,
        params: HostParams<TMethod>
    ) => Promise<HostResult<TMethod>>;
    listAllTyped: <TMethod extends NamespaceMethod<TNamespace>>(
        method: TMethod,
        params: HostParams<TMethod>,
        pageSize?: number
    ) => Promise<ArrayListItem<HostResult<TMethod>>[]>;
};

type ArrayListItem<TResult> = TResult extends {items?: Array<infer TItem>}
    ? TItem
    : unknown;

function methodParts(method: string): [string, string[]] {
    const [namespace, ...path] = method.split('.');
    if (!namespace || path.length === 0) {
        throw new Error(`Host domain method is invalid: ${method}`);
    }
    return [namespace, path];
}

export function createHostDomain<TNamespace extends string>(
    namespace: TNamespace
): TypedHostDomainApi<TNamespace> {
    return Object.assign(api[namespace], {
        call<TResult = unknown>(
            methodPath: string | readonly string[],
            params: object = {}
        ): Promise<TResult> {
            return call<TResult>(namespace, methodPath, params);
        },
        listAll<TItem = unknown>(
            methodPath: string | readonly string[],
            params: object = {},
            pageSize?: number
        ): Promise<TItem[]> {
            return listAll<TItem>(namespace, methodPath, params, pageSize);
        },
        describe(): Promise<unknown> {
            return call(namespace, 'describe', {});
        },
        callTyped<TMethod extends NamespaceMethod<TNamespace>>(
            method: TMethod,
            params: HostParams<TMethod>
        ): Promise<HostResult<TMethod>> {
            const [methodNamespace, path] = methodParts(method);
            return call<HostResult<TMethod>>(
                methodNamespace,
                path,
                params as object
            );
        },
        listAllTyped<TMethod extends NamespaceMethod<TNamespace>>(
            method: TMethod,
            params: HostParams<TMethod>,
            pageSize?: number
        ): Promise<ArrayListItem<HostResult<TMethod>>[]> {
            const [methodNamespace, path] = methodParts(method);
            return listAll<ArrayListItem<HostResult<TMethod>>>(
                methodNamespace,
                path,
                params as object,
                pageSize
            );
        }
    }) as TypedHostDomainApi<TNamespace>;
}

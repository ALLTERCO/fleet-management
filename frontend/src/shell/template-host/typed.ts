// Typed front door: callMethod is constrained by the generated HostContract,
// so only real methods compile. Regenerate via `cd backend && npm run generate`.

import {call} from './api';
import {
    HOST_NAMESPACE_GUIDE,
    type HostContract,
    type HostMethod,
    type HostNamespaceGuide,
    type HostParams,
    type HostResult
} from './generated/contract';

export type {
    HostContract,
    HostMethod,
    HostNamespaceGuide,
    HostParams,
    HostResult
};
export {HOST_NAMESPACE_GUIDE};

export function callMethod<M extends HostMethod>(
    method: M,
    params: HostParams<M>
): Promise<HostResult<M>> {
    const [namespace, ...methodPath] = method.split('.');
    return call<HostResult<M>>(namespace, methodPath, params as object);
}

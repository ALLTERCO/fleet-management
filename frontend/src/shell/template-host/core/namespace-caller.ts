// One typed call helper, instead of one per domain.
//
// Twenty-four domains declared the same five lines under sixteen different
// names — `call`, `notify`, `entity`, `schedule`, and so on. Identical bodies,
// so a fix to one reached none of the others, and a reader had to check each
// file to learn it was the same thing.

import type {HostMethod, HostParams, HostResult} from '../generated/contract';
import type {FleetRpcAccess} from './types';

/** Calls any method in one namespace, with that namespace's exact types. */
export type NamespaceCaller<TMethod extends HostMethod> = <M extends TMethod>(
    method: M,
    params: HostParams<M>
) => Promise<HostResult<M>>;

/**
 * `const call = namespaceCaller<AlertMethod>(access)`.
 *
 * The type argument is what narrows it: a domain that passes its own
 * `Extract<HostMethod, 'alert.${string}'>` cannot then call another
 * namespace's method by accident.
 */
export function namespaceCaller<TMethod extends HostMethod>(
    access: FleetRpcAccess
): NamespaceCaller<TMethod> {
    return <M extends TMethod>(method: M, params: HostParams<M>) =>
        access.rpc<HostResult<M>>(method, params as object);
}

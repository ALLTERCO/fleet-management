import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

export type FleetKindDomain = ReturnType<typeof createKindDomain>;

type KindMethod = Extract<HostMethod, `kind.${string}`>;

export function createKindDomain(access: FleetRpcAccess) {
    const call = namespaceCaller<KindMethod>(access);
    return {
        list(
            params: HostParams<'kind.list'> = {}
        ): Promise<HostResult<'kind.list'>> {
            return call('kind.list', params);
        },
        get(params: HostParams<'kind.get'>): Promise<HostResult<'kind.get'>> {
            return call('kind.get', params);
        },
        create(
            params: HostParams<'kind.create'>
        ): Promise<HostResult<'kind.create'>> {
            return call('kind.create', params);
        },
        /** Every field is required — omitting one clears it, it is not a patch. */
        update(
            params: HostParams<'kind.update'>
        ): Promise<HostResult<'kind.update'>> {
            return call('kind.update', params);
        },
        // Devices carrying this kind lose it; they are not deleted.
        delete(
            params: HostParams<'kind.delete'>
        ): Promise<HostResult<'kind.delete'>> {
            return call('kind.delete', params);
        }
    };
}

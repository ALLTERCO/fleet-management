import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

export type FleetAuditDomain = ReturnType<typeof createAuditDomain>;

type AuditMethod = Extract<HostMethod, `audit.${string}`>;

export function createAuditDomain(access: FleetRpcAccess) {
    const call = namespaceCaller<AuditMethod>(access);
    return {
        query(
            params: HostParams<'audit.query'> = {}
        ): Promise<HostResult<'audit.query'>> {
            return call('audit.query', params);
        },
        /** Returns a download link, not the rows — an export of a wide window
         *  is far too big to come back over RPC. */
        export(
            params: HostParams<'audit.export'>
        ): Promise<HostResult<'audit.export'>> {
            return call('audit.export', params);
        }
    };
}

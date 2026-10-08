// Gas billing conversion configuration. No client-side conversion lives here:
// the backend resolves effective profiles and calorific-value revisions.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type GasConversionMethod = Extract<HostMethod, `gasconversion.${string}`>;

export type FleetGasConversionDomain = ReturnType<
    typeof createGasConversionDomain
>;

export function createGasConversionDomain(access: FleetRpcAccess) {
    const call = namespaceCaller<GasConversionMethod>(access);
    return {
        upsertZone(
            params: HostParams<'gasconversion.upsertzone'>
        ): Promise<HostResult<'gasconversion.upsertzone'>> {
            return call('gasconversion.upsertzone', params);
        },
        upsertProfile(
            params: HostParams<'gasconversion.upsertprofile'>
        ): Promise<HostResult<'gasconversion.upsertprofile'>> {
            return call('gasconversion.upsertprofile', params);
        },
        addCalorificValue(
            params: HostParams<'gasconversion.addcalorificvalue'>
        ): Promise<HostResult<'gasconversion.addcalorificvalue'>> {
            return call('gasconversion.addcalorificvalue', params);
        }
    };
}

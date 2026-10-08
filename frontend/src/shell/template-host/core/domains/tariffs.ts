// Typed tariff namespace over the Fleet-owned tariff contract.
//
// Assignment and pricing reads publish response schemas.
// The remaining shapes stay hand-written here.

import type {TariffSpec} from '@api/tariff';
import type {HostParams, HostResult} from '../../generated/contract';
import type {FleetRpcAccess} from '../types';

export type HostTariff = TariffSpec & {id: number};
export type HostTariffListItem = Pick<
    HostTariff,
    | 'id'
    | 'name'
    | 'kind'
    | 'commodity'
    | 'billedUnit'
    | 'currency'
    | 'effectiveFrom'
    | 'effectiveTo'
    | 'sourceReference'
>;
export type HostTariffAssignmentScope =
    | 'organization'
    | 'location'
    | 'device'
    | 'channel';
export type HostTariffAssignmentInput = {
    tariffId: number;
    scopeLevel: HostTariffAssignmentScope;
    locationId?: number | null;
    deviceExternalId?: string | null;
    channel?: number | null;
    direction?: 'import' | 'export';
    delete?: boolean;
};
/** `scopeLevel` may still read `dashboard` here — assignments written before
 *  the canonical organization/location/device/channel hierarchy existed. */
export type HostTariffAssignment =
    HostResult<'tariff.listassignments'>['items'][number];
export type HostTariffResolutionPoint =
    HostParams<'tariff.resolveassignments'>['points'][number];
export type HostTariffResolvedAssignment =
    HostResult<'tariff.resolveassignments'>['items'][number];
export type HostTariffBillingPeriodsParams =
    HostParams<'tariff.billingperiods'>;
export type HostTariffBillingPeriod =
    HostResult<'tariff.billingperiods'>['items'][number];
export type HostTariffBillingPeriodAtParams =
    HostParams<'tariff.billingperiodat'>;
export type HostTariffBillingPeriodAt = HostResult<'tariff.billingperiodat'>;
export type HostTariffPricingParams = HostParams<'tariff.resolvepricing'>;
export type HostTariffPricing = HostResult<'tariff.resolvepricing'>;
export type HostTariffPricingUnavailableReason = NonNullable<
    HostTariffPricing['unavailableReason']
>;
export type HostTariffLiveSourceInput = HostParams<'tariff.setlivesource'>;

export type FleetTariffDomain = ReturnType<typeof createTariffDomain>;

export function createTariffDomain(access: FleetRpcAccess) {
    return {
        async list(): Promise<HostTariffListItem[]> {
            const result = await access.rpc<HostResult<'tariff.list'>>(
                'tariff.list',
                {}
            );
            return result.items ?? [];
        },
        async get(id: number): Promise<HostTariff> {
            const result = await access.rpc<HostResult<'tariff.get'>>(
                'tariff.get',
                {id}
            );
            return result.tariff;
        },
        async billingPeriods(
            params: HostTariffBillingPeriodsParams
        ): Promise<HostTariffBillingPeriod[]> {
            const result = await access.rpc<
                HostResult<'tariff.billingperiods'>
            >('tariff.billingperiods', params);
            return result.items;
        },
        billingPeriodAt(
            params: HostTariffBillingPeriodAtParams
        ): Promise<HostTariffBillingPeriodAt> {
            return access.rpc('tariff.billingperiodat', params);
        },
        async listAssignments(): Promise<HostTariffAssignment[]> {
            const result = await access.rpc<
                HostResult<'tariff.listassignments'>
            >('tariff.listassignments', {});
            return result.items ?? [];
        },
        async resolveAssignments(
            points: HostTariffResolutionPoint[]
        ): Promise<HostTariffResolvedAssignment[]> {
            const result = await access.rpc<
                HostResult<'tariff.resolveassignments'>
            >('tariff.resolveassignments', {points});
            return result.items ?? [];
        },
        resolvePricing(
            input: HostTariffPricingParams
        ): Promise<HostTariffPricing> {
            return access.rpc('tariff.resolvepricing', input);
        },
        // The RPC is `tariff.add`; `create` is the name the other three use.
        create(input: TariffSpec): Promise<{id: number}> {
            return access.rpc('tariff.add', input);
        },
        update(input: HostTariff): Promise<{id: number}> {
            return access.rpc('tariff.update', input);
        },
        delete(id: number): Promise<{deleted: boolean}> {
            return access.rpc('tariff.delete', {id});
        },
        assign(input: HostTariffAssignmentInput): Promise<{ok: boolean}> {
            return access.rpc('tariff.assign', input);
        },
        setLiveSource(
            input: HostTariffLiveSourceInput
        ): Promise<HostResult<'tariff.setlivesource'>> {
            return access.rpc('tariff.setlivesource', input);
        }
    };
}

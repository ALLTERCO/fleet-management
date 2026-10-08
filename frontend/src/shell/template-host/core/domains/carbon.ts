// Versioned carbon factors and valuations. Physical emissions and monetary
// carbon values stay separate: calculate returns both disclosures explicitly.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {createInFlightCoalescer} from '../in-flight';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type CarbonMethod = Extract<HostMethod, `carbon.${string}`>;

export type FleetCarbonDomain = ReturnType<typeof createCarbonDomain>;
export type HostCarbonBreakdownParams = HostParams<'carbon.calculatebreakdown'>;
export type HostCarbonBreakdownResult = HostResult<'carbon.calculatebreakdown'>;

function breakdownRequestKey(params: HostCarbonBreakdownParams): string {
    const scope = params.scope
        ? {
              groupId: params.scope.groupId ?? null,
              locationId: params.scope.locationId ?? null,
              tagId: params.scope.tagId ?? null
          }
        : null;
    return JSON.stringify({
        from: params.from,
        to: params.to,
        granularity: params.granularity,
        scope,
        locationIds: params.locationIds
            ? [...params.locationIds].sort((a, b) => a - b)
            : null,
        timezone: params.timezone ?? null,
        dashboardId: params.dashboardId ?? null
    });
}

export function createCarbonDomain(access: FleetRpcAccess) {
    const call = namespaceCaller<CarbonMethod>(access);
    const coalesceBreakdown =
        createInFlightCoalescer<HostCarbonBreakdownResult>();
    return {
        listEmissionFactors(
            params: HostParams<'carbon.listemissionfactors'> = {}
        ): Promise<HostResult<'carbon.listemissionfactors'>> {
            return call('carbon.listemissionfactors', params);
        },
        addEmissionFactor(
            params: HostParams<'carbon.addemissionfactor'>
        ): Promise<HostResult<'carbon.addemissionfactor'>> {
            return call('carbon.addemissionfactor', params);
        },
        listPrices(
            params: HostParams<'carbon.listprices'> = {}
        ): Promise<HostResult<'carbon.listprices'>> {
            return call('carbon.listprices', params);
        },
        addPrice(
            params: HostParams<'carbon.addprice'>
        ): Promise<HostResult<'carbon.addprice'>> {
            return call('carbon.addprice', params);
        },
        calculate(
            params: HostParams<'carbon.calculate'>
        ): Promise<HostResult<'carbon.calculate'>> {
            return call('carbon.calculate', params);
        },
        calculateBreakdown(
            params: HostCarbonBreakdownParams
        ): Promise<HostCarbonBreakdownResult> {
            return coalesceBreakdown(breakdownRequestKey(params), () =>
                call('carbon.calculatebreakdown', params)
            );
        }
    };
}

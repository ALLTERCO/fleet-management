// Canonical utility billing. Templates select Fleet scope and time only;
// tariffs, assignments, conversions and every charge stay server-owned. The
// device breakdown is measured usage only; templates must not allocate the
// aggregate contract charges themselves.

import type {HostParams, HostResult} from '../../generated/contract';
import {createTtlCoalescer} from '../in-flight';
import type {FleetRpcAccess} from '../types';

// Templates re-ask the same quote on every remount; reuse it briefly.
const QUOTE_REUSE_TTL_MS = 30_000;

export type HostUtilityCostParams = HostParams<'bill.quote'>;
export type HostUtilityCost = HostResult<'bill.quote'>;
/** One bar of the optional measured-usage series (`seriesBucket`). Usage only:
 * standing, demand, component and tax amounts are never apportioned into it. */
export type HostUtilityCostBucket = NonNullable<
    HostUtilityCost['series']
>[number];
/** The self-consumption counterfactual (`avoidedImportCost`). An estimate of a
 * cost that was never billed — never add it to any total. */
export type HostAvoidedImportCost = NonNullable<
    HostUtilityCost['avoidedImportCost']
>;
export type FleetBillingDomain = ReturnType<typeof createBillingDomain>;

function quoteRequestKey(params: HostUtilityCostParams): string {
    const channels = params.channels
        ? [...params.channels]
              .sort(
                  (a, b) =>
                      a.device.localeCompare(b.device) || a.channel - b.channel
              )
              .map(({device, channel}) => ({device, channel}))
        : null;
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
        commodity: params.commodity,
        billedUnit: params.billedUnit ?? null,
        scope,
        devices: params.devices ? [...params.devices].sort() : null,
        channels,
        meterIds: params.meterIds
            ? [...params.meterIds].sort((a, b) => a - b)
            : null,
        seriesBucket: params.seriesBucket ?? null,
        avoidedImportCost: params.avoidedImportCost ?? null
    });
}

export function createBillingDomain(access: FleetRpcAccess) {
    const coalesceQuote = createTtlCoalescer<HostUtilityCost>({
        ttlMs: QUOTE_REUSE_TTL_MS
    });

    return {
        quote(params: HostUtilityCostParams): Promise<HostUtilityCost> {
            return coalesceQuote(quoteRequestKey(params), () =>
                access.rpc<HostUtilityCost>('bill.quote', params)
            );
        }
    };
}

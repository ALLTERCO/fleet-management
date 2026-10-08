// Every RPC the Bill page needs, one method per method name. Pages and panels
// never build an RPC payload themselves.

import type {
    BillListParams,
    BillListResponse,
    BillQuoteParams,
    BillQuoteResponse
} from '@api/bill';
import {defineStore} from 'pinia';
import {domainErrorKind, formatRpcError} from '@/helpers/domainErrors';
import type {
    HostParams,
    HostResult
} from '@/shell/template-host/generated/contract';
import {sendRPC} from '@/tools/websocket';

const DST = 'FLEET_MANAGER';

export type TariffSummary = HostResult<'tariff.list'>['items'][number];
export type TariffDetail = HostResult<'tariff.get'>['tariff'];
export type TariffBillingPeriod =
    HostResult<'tariff.billingperiods'>['items'][number];
export type TariffResolutionPoint =
    HostParams<'tariff.resolveassignments'>['points'][number];
export type TariffResolvedAssignment =
    HostResult<'tariff.resolveassignments'>['items'][number];

export interface TariffBillingPeriodsQuery {
    tariffId: number;
    from: string;
    to: string;
}

export const useBillingStore = defineStore('billing', () => {
    function quoteBill(params: BillQuoteParams): Promise<BillQuoteResponse> {
        return callBillingRpc<BillQuoteResponse>({
            method: 'bill.Quote',
            params,
            fallback: 'Could not calculate the bill.'
        });
    }

    async function listTariffs(): Promise<TariffSummary[]> {
        const result = await callBillingRpc<HostResult<'tariff.list'>>({
            method: 'tariff.List',
            params: {},
            fallback: 'Could not load the tariffs.'
        });
        return result.items;
    }

    // The header rows of tariff.List carry no timezone; only the full tariff
    // says which local day a billing period opens on.
    async function getTariff(id: number): Promise<TariffDetail> {
        const result = await callBillingRpc<HostResult<'tariff.get'>>({
            method: 'tariff.Get',
            params: {id},
            fallback: 'Could not load the tariff.'
        });
        return result.tariff;
    }

    // The backend owns tariff precedence, so it is asked which tariff prices
    // each point instead of the page working it out from the assignment list.
    async function resolveTariffAssignments(
        points: readonly TariffResolutionPoint[]
    ): Promise<TariffResolvedAssignment[]> {
        const result = await callBillingRpc<
            HostResult<'tariff.resolveassignments'>
        >({
            method: 'tariff.ResolveAssignments',
            params: {points},
            fallback: 'Could not check which tariffs price this scope.'
        });
        return result.items;
    }

    async function listBillingPeriods(
        query: TariffBillingPeriodsQuery
    ): Promise<TariffBillingPeriod[]> {
        const result = await callBillingRpc<
            HostResult<'tariff.billingperiods'>
        >({
            method: 'tariff.BillingPeriods',
            params: query,
            fallback: 'Could not load the billing periods.'
        });
        return result.items;
    }

    function listRecordedBills(
        params: BillListParams
    ): Promise<BillListResponse> {
        return callBillingRpc<BillListResponse>({
            method: 'bill.List',
            params,
            fallback: 'Could not load the recorded bills.'
        });
    }

    return {
        quoteBill,
        listTariffs,
        getTariff,
        resolveTariffAssignments,
        listBillingPeriods,
        listRecordedBills
    };
});

interface BillingRpcCall {
    method: string;
    params: object;
    fallback: string;
}

// The only try/catch in this store: every billing call fails with a sentence a
// person can read, and carries the wire error as its cause.
async function callBillingRpc<T>(call: BillingRpcCall): Promise<T> {
    try {
        return await sendRPC<T>(DST, call.method, call.params);
    } catch (error) {
        throw new Error(billingFailureMessage(error, call.fallback), {
            cause: error
        });
    }
}

// The expensive-quote limiter is the one refusal the user can act on, so it
// gets an instruction instead of the wire message.
function billingFailureMessage(error: unknown, fallback: string): string {
    if (domainErrorKind(error) === 'RateLimitExceeded') {
        return 'Too many bill calculations at once. Wait a moment, then try again.';
    }
    return formatRpcError(error, fallback);
}

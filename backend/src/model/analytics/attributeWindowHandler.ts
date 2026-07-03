/** Pure handler for `Analytics.AttributeWindow`. No Component-class import,
 *  no PG import — exercised via a small repo interface so tests can pass a
 *  fake. Top-down narrative: validate → resolve scope → query → assemble.
 */

import {DAY_MS} from '../../modules/util/timeUnits';
import RpcError from '../../rpc/RpcError';
import {
    ATTRIBUTE_WINDOW_DEFAULT_TOP_N,
    ATTRIBUTE_WINDOW_MAX_DAYS,
    type AttributeAggregation,
    type AttributeMetric,
    type AttributeWindowQuery,
    type AttributeWindowResult,
    type Contributor
} from '../../types/api/analytics';
import {assertSingleAxis, scopeId, scopeKind} from '../../types/api/fleet';
import {
    isAggregationAllowedForMetric,
    resolveDefaultAggregation
} from './aggregationDefault';
import {type AggregateBucket, pickAggregateBucket} from './bucketPick';
import {truncateContributors} from './contributorTruncate';

const UNITS: Readonly<Record<AttributeMetric, string>> = {
    consumption: 'kWh',
    power: 'W',
    voltage: 'V',
    temperature: '°C'
};

export interface AttributeWindowRepo {
    /** Resolve the device set for the request and return shellyID list. */
    resolveScopeShellyIDs(input: {
        scopeKind: 'group' | 'location' | 'tag' | 'fleet';
        scopeIdValue: number | null;
        organizationId: string;
        explicitDevices: string[] | undefined;
    }): Promise<string[]>;

    /** Per-device aggregated value over the window. */
    queryContributors(input: {
        shellyIDs: string[];
        from: Date;
        to: Date;
        bucket: AggregateBucket;
        metric: AttributeMetric;
        aggregation: AttributeAggregation;
    }): Promise<Contributor[]>;
}

export interface AttributeWindowSender {
    getOrganizationId(): string | undefined;
    isAdmin(): boolean;
    canCrossOrganizations?(): boolean;
}

export async function handleAttributeWindow(
    params: AttributeWindowQuery,
    sender: AttributeWindowSender,
    repo: AttributeWindowRepo
): Promise<AttributeWindowResult> {
    assertScopeOrDevices(params);
    const {from, to} = parseAndValidateRange(params.from, params.to);
    const aggregation = resolveAndValidateAggregation(
        params.metric,
        params.aggregation
    );
    const topN = params.topN ?? ATTRIBUTE_WINDOW_DEFAULT_TOP_N;
    const bucket = pickAggregateBucket(to.getTime() - from.getTime());
    const orgId = requireOrgFromSender(sender);

    const shellyIDs = await repo.resolveScopeShellyIDs({
        scopeKind: scopeKind(params.scope),
        scopeIdValue: scopeId(params.scope),
        organizationId: orgId,
        explicitDevices: params.devices
    });

    const window: Window = {metric: params.metric, from, to, aggregation};
    if (shellyIDs.length === 0) return emptyResult(window);

    const rows = await repo.queryContributors({
        shellyIDs,
        bucket,
        ...window
    });
    return assembleResult({rows, window, topN});
}

interface Window {
    metric: AttributeMetric;
    from: Date;
    to: Date;
    aggregation: AttributeAggregation;
}

function assertScopeOrDevices(params: AttributeWindowQuery): void {
    if (params.scope !== undefined && params.devices !== undefined) {
        throw RpcError.InvalidParams(
            'scope and devices are mutually exclusive'
        );
    }
    if (params.scope) assertSingleAxis(params.scope);
}

function parseAndValidateRange(
    fromIso: string,
    toIso: string
): {from: Date; to: Date} {
    const from = new Date(fromIso);
    const to = new Date(toIso);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw RpcError.InvalidParams('invalid_window: bad ISO date');
    }
    if (from.getTime() >= to.getTime()) {
        throw RpcError.InvalidParams('invalid_window: from must be < to');
    }
    if (to.getTime() - from.getTime() > ATTRIBUTE_WINDOW_MAX_DAYS * DAY_MS) {
        throw RpcError.InvalidParams(
            `invalid_window: range exceeds ${ATTRIBUTE_WINDOW_MAX_DAYS} days`
        );
    }
    return {from, to};
}

function resolveAndValidateAggregation(
    metric: AttributeMetric,
    requested: AttributeAggregation | undefined
): AttributeAggregation {
    const chosen = requested ?? resolveDefaultAggregation(metric);
    if (!isAggregationAllowedForMetric(metric, chosen)) {
        throw RpcError.InvalidParams(
            `invalid_aggregation_for_metric: ${chosen} not allowed for ${metric}`
        );
    }
    return chosen;
}

function requireOrgFromSender(sender: AttributeWindowSender): string {
    const orgId = sender.getOrganizationId();
    if (!orgId) throw RpcError.Unauthorized();
    return orgId;
}

function emptyResult(w: Window): AttributeWindowResult {
    return {
        metric: w.metric,
        from: w.from.toISOString(),
        to: w.to.toISOString(),
        aggregation: w.aggregation,
        unit: UNITS[w.metric],
        totalValue: 0,
        contributors: [],
        truncated: false,
        truncatedCount: 0
    };
}

function assembleResult(input: {
    rows: Contributor[];
    window: Window;
    topN: number;
}): AttributeWindowResult {
    const totalValue = input.rows.reduce((acc, r) => acc + r.value, 0);
    const rowsWithShare = input.rows.map((r) => ({
        ...r,
        share: totalValue > 0 ? r.value / totalValue : 0
    }));
    const {contributors, truncated, truncatedCount} = truncateContributors(
        rowsWithShare,
        input.topN
    );
    return {
        metric: input.window.metric,
        from: input.window.from.toISOString(),
        to: input.window.to.toISOString(),
        aggregation: input.window.aggregation,
        unit: UNITS[input.window.metric],
        totalValue,
        contributors,
        truncated,
        truncatedCount
    };
}

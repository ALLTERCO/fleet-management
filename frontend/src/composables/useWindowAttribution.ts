// useWindowAttribution — calls Analytics.AttributeWindow for brush-to-
// compare and exposes the contributor breakdown reactively. Debounces
// rapid brush selections (150ms) and aborts stale requests via a
// monotonically increasing call ID. Caller drives the range via
// {from, to} ISO timestamps; metric + scope come in as reactive refs
// so a scope-picker change refetches automatically.

import type {AttributeMetric, AttributeWindowResult} from '@api/analytics';
import type {DashboardScope as ApiScope} from '@api/fleet';
import {
    type MaybeRefOrGetter,
    onScopeDispose,
    type Ref,
    ref,
    toValue,
    watch
} from 'vue';
import type {DashboardScope as FrontendScope} from '@/composables/useDashboardScope';
import * as ws from '@/tools/websocket';

export interface AttributionRange {
    from: string;
    to: string;
}

export interface UseWindowAttributionApi {
    readonly range: Ref<AttributionRange | null>;
    readonly result: Ref<AttributeWindowResult | null>;
    readonly loading: Ref<boolean>;
    readonly error: Ref<string | null>;
    readonly setRange: (next: AttributionRange | null) => void;
}

const DEBOUNCE_MS = 150;
// Matches backend ATTRIBUTE_WINDOW_MAX_DAYS — keep in sync; the RPC will
// reject anything beyond this anyway so we fail fast on the client.
const MAX_WINDOW_DAYS = 90;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function useWindowAttribution(opts: {
    metric: MaybeRefOrGetter<AttributeMetric>;
    scope: MaybeRefOrGetter<FrontendScope>;
    topN?: MaybeRefOrGetter<number | undefined>;
}): UseWindowAttributionApi {
    const range = ref<AttributionRange | null>(null);
    const result = ref<AttributeWindowResult | null>(null);
    const loading = ref(false);
    const error = ref<string | null>(null);

    let abortId = 0;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function clearOutput() {
        result.value = null;
        error.value = null;
    }

    function startCall(): number {
        loading.value = true;
        error.value = null;
        return ++abortId;
    }

    function isStillCurrent(callId: number): boolean {
        return !disposed && callId === abortId;
    }

    function applyResult(
        res: AttributeWindowResult | null,
        callId: number
    ): void {
        if (!isStillCurrent(callId)) return;
        result.value = res ?? null;
    }

    function handleError(err: unknown, callId: number): void {
        if (!isStillCurrent(callId)) return;
        error.value = err instanceof Error ? err.message : String(err);
        result.value = null;
    }

    function endCall(callId: number): void {
        if (isStillCurrent(callId)) loading.value = false;
    }

    async function runRpc(
        r: AttributionRange
    ): Promise<AttributeWindowResult | null> {
        return ws.sendRPC<AttributeWindowResult>(
            'FLEET_MANAGER',
            'Analytics.AttributeWindow',
            {
                metric: toValue(opts.metric),
                from: r.from,
                to: r.to,
                scope: toApiScope(toValue(opts.scope)),
                topN: toValue(opts.topN)
            }
        );
    }

    async function call() {
        const r = range.value;
        if (!r) return clearOutput();
        const callId = startCall();
        try {
            applyResult(await runRpc(r), callId);
        } catch (err) {
            handleError(err, callId);
        } finally {
            endCall(callId);
        }
    }

    function schedule() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(call, DEBOUNCE_MS);
    }

    function setRange(next: AttributionRange | null): void {
        if (next === null || !isValidRange(next)) {
            range.value = null;
            clearOutput();
            return;
        }
        range.value = next;
        schedule();
    }

    // Metric/scope changes invalidate the current breakdown — refetch with
    // the existing range so the panel keeps reflecting whatever the user
    // last selected on the chart.
    watch(
        () => [toValue(opts.metric), toValue(opts.scope)] as const,
        () => {
            if (range.value) schedule();
        }
    );

    onScopeDispose(() => {
        disposed = true;
        if (debounceTimer) clearTimeout(debounceTimer);
    });

    return {range, result, loading, error, setRange};
}

// Reject brush ranges that the backend would reject anyway: non-ISO
// bucket strings, inverted/zero-length windows, and anything > 90 days.
export function isValidRange(r: AttributionRange): boolean {
    const fromMs = parseIsoMs(r.from);
    const toMs = parseIsoMs(r.to);
    if (fromMs === null || toMs === null) return false;
    if (toMs <= fromMs) return false;
    return toMs - fromMs <= MAX_WINDOW_DAYS * ONE_DAY_MS;
}

function parseIsoMs(s: string): number | null {
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
    const ms = Date.parse(s);
    return Number.isNaN(ms) ? null : ms;
}

// Convert the frontend scope shape (kind+id) to the backend's single-axis
// object. Empty object means fleet — matches backend DashboardScope.
export function toApiScope(scope: FrontendScope): ApiScope {
    if (scope.kind === 'group' && typeof scope.id === 'number')
        return {groupId: scope.id};
    if (scope.kind === 'tag' && typeof scope.id === 'number')
        return {tagId: scope.id};
    if (scope.kind === 'location' && typeof scope.id === 'number')
        return {locationId: scope.id};
    return {};
}

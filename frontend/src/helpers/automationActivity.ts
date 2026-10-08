// Turns automation.GetActivity into "last run / recent errors" per flow.

import type {
    AutomationActivityResult,
    AutomationFlowActivity
} from '@/api/automationRpc';

export interface FlowActivityError {
    at: number | null;
    message: string;
}

export interface FlowActivity {
    lastRunAt: number | null;
    lastErrorAt: number | null;
    recentErrors: FlowActivityError[];
}

export type FlowActivityByFlowId = Map<string, FlowActivity>;

type ActivityError = AutomationFlowActivity['errors'][number];

const RECENT_ERROR_LIMIT = 3;

/** One activity summary per flow id. */
export function indexFlowActivity(
    result: AutomationActivityResult
): FlowActivityByFlowId {
    return new Map(
        result.items.map((item) => [item.flowId, toFlowActivity(item)])
    );
}

function toFlowActivity(item: AutomationFlowActivity): FlowActivity {
    return {
        lastRunAt: toTime(item.lastRunAt),
        lastErrorAt: toTime(item.lastErrorAt),
        recentErrors: newestErrors(item.errors)
    };
}

function newestErrors(errors: readonly ActivityError[]): FlowActivityError[] {
    return errors
        .map(toFlowActivityError)
        .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
        .slice(0, RECENT_ERROR_LIMIT);
}

function toFlowActivityError(error: ActivityError): FlowActivityError {
    return {
        at: toTime(error.at),
        message: error.message?.trim() || `${error.nodeType} node failed`
    };
}

function toTime(value: string | undefined): number | null {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
}

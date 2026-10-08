// Last run and recent errors per Node-RED flow, reported by the nodes.
//
// Node-RED keeps no run history, so the nodes report it. In memory on
// purpose: this is a "what happened lately" view, not an audit trail, and a
// restart starting empty is acceptable. Caps keep a chatty or hostile flow
// from growing memory without bound.

export const ACTIVITY_LIMITS = {
    /** Errors kept per flow, newest first. */
    errorsPerFlow: 20,
    /** Flows tracked at once; the least recently active one is dropped. */
    flows: 500
} as const;

export type ActivityKind = 'run' | 'error';

export interface ActivityReport {
    flowId: string;
    nodeId: string;
    nodeType: string;
    kind: ActivityKind;
    message?: string;
}

export interface ActivityError {
    at: string;
    nodeId: string;
    nodeType: string;
    message?: string;
}

export interface FlowActivity {
    flowId: string;
    lastRunAt?: string;
    runCount: number;
    errorCount: number;
    lastErrorAt?: string;
    errors: ActivityError[];
}

type Recorder = (flow: FlowActivity, input: TimedReport) => void;

interface TimedReport {
    report: ActivityReport;
    at: string;
}

function recordRun(flow: FlowActivity, input: TimedReport): void {
    flow.lastRunAt = input.at;
    flow.runCount += 1;
}

function recordError(flow: FlowActivity, input: TimedReport): void {
    flow.errorCount += 1;
    flow.lastErrorAt = input.at;
    flow.errors.unshift({
        at: input.at,
        nodeId: input.report.nodeId,
        nodeType: input.report.nodeType,
        ...(input.report.message === undefined
            ? {}
            : {message: input.report.message})
    });
    flow.errors.length = Math.min(
        flow.errors.length,
        ACTIVITY_LIMITS.errorsPerFlow
    );
}

const RECORDERS: Record<ActivityKind, Recorder> = {
    run: recordRun,
    error: recordError
};

function emptyActivity(flowId: string): FlowActivity {
    return {flowId, runCount: 0, errorCount: 0, errors: []};
}

function copyOf(flow: FlowActivity): FlowActivity {
    return {...flow, errors: flow.errors.map((error) => ({...error}))};
}

export class ActivityStore {
    // Map keeps insertion order; re-inserting on each report makes the first
    // key the least recently active flow.
    readonly #flows = new Map<string, FlowActivity>();

    record(report: ActivityReport, now: Date = new Date()): void {
        const flow =
            this.#flows.get(report.flowId) ?? emptyActivity(report.flowId);
        RECORDERS[report.kind](flow, {report, at: now.toISOString()});
        this.#flows.delete(report.flowId);
        this.#flows.set(report.flowId, flow);
        this.#dropOldest();
    }

    /** One flow, or every tracked flow when flowId is omitted. */
    read(flowId?: string): FlowActivity[] {
        if (flowId === undefined) {
            return [...this.#flows.values()].map(copyOf);
        }
        const flow = this.#flows.get(flowId);
        return flow ? [copyOf(flow)] : [];
    }

    #dropOldest(): void {
        while (this.#flows.size > ACTIVITY_LIMITS.flows) {
            const oldest = this.#flows.keys().next().value;
            if (oldest === undefined) return;
            this.#flows.delete(oldest);
        }
    }
}

export const activityStore = new ActivityStore();

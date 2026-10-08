// Automations as when / who / what.
//
// Every example flow that ships with the node package is this shape: something
// triggers, a target says which devices, one node acts. Four records. Building
// that from three parameters is safe; a caller cannot emit a half-wired graph
// because the wiring is not theirs to write.
//
// The method is checked against the generated catalog, so a made-up method is
// refused before anything is deployed.
//
// Reading is the inverse and is allowed to fail. A flow built by hand in the
// editor may be any shape at all, and saying "I cannot edit this" is the only
// honest answer for one. Rewriting it into this shape would throw away work.

import {isFlowTab, nodeTypeForMethod} from './flowCatalog';
import type {FlowObject, FlowRecord} from './flowClient';

export type AutomationTrigger =
    | {kind: 'cron'; cron: string}
    | {kind: 'everySeconds'; seconds: number}
    | {kind: 'onEvents'; events: string[]};

export interface AutomationTarget {
    deviceIds?: string[];
    groupIds?: number[];
    locationIds?: number[];
    tagKeys?: string[];
    /** The whole fleet. Deliberately explicit, never the default. */
    fleet?: boolean;
}

export interface AutomationAction {
    method: string;
    params?: Record<string, unknown>;
}

export interface AutomationRecipe {
    name: string;
    when: AutomationTrigger;
    who: AutomationTarget;
    what: AutomationAction;
}

const SERVER_NODE = 'fm-server';
const TARGET_NODE = 'fm-target';
const EVENT_NODE = 'fm-device-event';
const INJECT_NODE = 'inject';

/** Left to right, matching how the editor lays a flow out. */
const ROW_Y = 200;
const COLUMN_X = [180, 420, 660];

export type IdFactory = (role: string) => string;

function csv(values: readonly (string | number)[] | undefined): string {
    return (values ?? []).map(String).join(',');
}

function triggerRecord(
    recipe: AutomationRecipe,
    ids: {flow: string; trigger: string; next: string; server: string}
): FlowRecord {
    const base = {
        id: ids.trigger,
        z: ids.flow,
        x: COLUMN_X[0],
        y: ROW_Y,
        wires: [[ids.next]]
    };
    if (recipe.when.kind === 'onEvents') {
        return {
            ...base,
            type: EVENT_NODE,
            name: `On ${recipe.when.events.join(', ')}`,
            server: ids.server,
            events: csv(recipe.when.events),
            filterJson: '{}'
        };
    }
    const cron = recipe.when.kind === 'cron' ? recipe.when.cron : '';
    const repeat =
        recipe.when.kind === 'everySeconds' ? String(recipe.when.seconds) : '';
    return {
        ...base,
        type: INJECT_NODE,
        name: cron ? `At ${cron}` : `Every ${repeat}s`,
        props: [],
        repeat,
        crontab: cron,
        once: false
    };
}

function targetRecord(
    recipe: AutomationRecipe,
    ids: {flow: string; target: string; next: string}
): FlowRecord {
    return {
        id: ids.target,
        type: TARGET_NODE,
        z: ids.flow,
        name: 'Target',
        deviceIds: csv(recipe.who.deviceIds),
        groupIds: csv(recipe.who.groupIds),
        locationIds: csv(recipe.who.locationIds),
        tagKeys: csv(recipe.who.tagKeys),
        fleet: recipe.who.fleet === true,
        x: COLUMN_X[1],
        y: ROW_Y,
        wires: [[ids.next]]
    };
}

function actionRecord(
    recipe: AutomationRecipe,
    nodeType: string,
    ids: {flow: string; action: string; server: string}
): FlowRecord {
    return {
        id: ids.action,
        type: nodeType,
        z: ids.flow,
        name: recipe.what.method,
        server: ids.server,
        operation: recipe.what.method,
        paramsSource: 'config',
        paramsJson: JSON.stringify(recipe.what.params ?? {}),
        x: COLUMN_X[2],
        y: ROW_Y,
        wires: [[]]
    };
}

/** The connection node, reused if the install already has one. */
function serverIdIn(records: readonly FlowRecord[]): string | null {
    const existing = records.find((record) => record.type === SERVER_NODE);
    return existing ? String(existing.id) : null;
}

export class UnknownAutomationMethod extends Error {
    constructor(method: string) {
        super(`no Fleet Manager method named ${method}`);
    }
}

export class InvalidAutomationRecipe extends Error {}

/**
 * Turns loose input into a trigger, or throws.
 *
 * JSON Schema cannot express "kind:'cron' requires cron", so it accepts
 * `{kind:'cron'}` with nothing else. That would deploy an automation with an
 * empty schedule: valid to Node-RED, never fires, no error anywhere. This is
 * where that is caught.
 */
export function parseTrigger(
    value: Record<string, unknown>
): AutomationTrigger {
    const kind = String(value.kind ?? '');
    if (kind === 'cron') {
        const cron = String(value.cron ?? '').trim();
        if (!cron) {
            throw new InvalidAutomationRecipe(
                'when.kind is "cron" so when.cron is required'
            );
        }
        return {kind: 'cron', cron};
    }
    if (kind === 'everySeconds') {
        const seconds = Number(value.seconds);
        if (!Number.isFinite(seconds) || seconds < 1) {
            throw new InvalidAutomationRecipe(
                'when.kind is "everySeconds" so when.seconds must be 1 or more'
            );
        }
        return {kind: 'everySeconds', seconds: Math.floor(seconds)};
    }
    if (kind === 'onEvents') {
        const events = Array.isArray(value.events)
            ? value.events.map(String).filter(Boolean)
            : [];
        if (events.length === 0) {
            throw new InvalidAutomationRecipe(
                'when.kind is "onEvents" so when.events needs at least one event'
            );
        }
        return {kind: 'onEvents', events};
    }
    throw new InvalidAutomationRecipe(`unknown trigger kind "${kind}"`);
}

/**
 * Turns loose input into a target, or throws when it names nothing.
 *
 * An empty target is not an automation that does nothing; it is an automation
 * whose author believed it covered something. Refusing is the honest answer.
 */
export function parseTarget(value: Record<string, unknown>): AutomationTarget {
    const strings = (key: string): string[] =>
        Array.isArray(value[key])
            ? (value[key] as unknown[]).map(String).filter(Boolean)
            : [];
    const numbers = (key: string): number[] =>
        Array.isArray(value[key])
            ? (value[key] as unknown[]).map(Number).filter(Number.isFinite)
            : [];
    const target: AutomationTarget = {
        deviceIds: strings('deviceIds'),
        groupIds: numbers('groupIds'),
        locationIds: numbers('locationIds'),
        tagKeys: strings('tagKeys'),
        fleet: value.fleet === true
    };
    const names =
        (target.deviceIds?.length ?? 0) +
        (target.groupIds?.length ?? 0) +
        (target.locationIds?.length ?? 0) +
        (target.tagKeys?.length ?? 0);
    if (names === 0 && !target.fleet) {
        throw new InvalidAutomationRecipe(
            'who names nothing; give devices, groups, locations or tags, or set fleet:true for every device'
        );
    }
    return target;
}

export function parseAction(value: Record<string, unknown>): AutomationAction {
    const method = String(value.method ?? '').trim();
    if (!method) throw new InvalidAutomationRecipe('what.method is required');
    const params = value.params;
    return {
        method,
        params:
            params && typeof params === 'object' && !Array.isArray(params)
                ? (params as Record<string, unknown>)
                : {}
    };
}

/**
 * Builds one automation in the shape the single-flow endpoints take.
 *
 * `nodes` is what runs; `configs` holds the connection node, and only when the
 * install has none yet. No tab record: POST /flow and PUT /flow/:id take the
 * flow itself, so the tab is the envelope, not a row inside it.
 *
 * `keep` carries the ids of an existing automation's nodes, so an update is an
 * edit in the editor rather than a delete plus an unrelated add.
 */
export function buildRecipeFlow(
    recipe: AutomationRecipe,
    context: {
        existing: readonly FlowRecord[];
        newId: IdFactory;
        flowId?: string;
        keep?: {trigger?: string; target?: string; action?: string};
    }
): FlowObject {
    const nodeType = nodeTypeForMethod(recipe.what.method);
    if (!nodeType) throw new UnknownAutomationMethod(recipe.what.method);

    const flow = context.flowId ?? context.newId('flow');
    const trigger = context.keep?.trigger ?? context.newId('trigger');
    const target = context.keep?.target ?? context.newId('target');
    const action = context.keep?.action ?? context.newId('action');
    const reusedServer = serverIdIn(context.existing);
    const server = reusedServer ?? context.newId('server');

    return {
        label: recipe.name,
        disabled: false,
        nodes: [
            triggerRecord(recipe, {flow, trigger, next: target, server}),
            targetRecord(recipe, {flow, target, next: action}),
            actionRecord(recipe, nodeType, {flow, action, server})
        ],
        // Only when there is nothing to reuse. A second connection node per
        // automation is a mess someone has to untangle by hand in the editor.
        configs: reusedServer
            ? []
            : [
                  {
                      id: server,
                      type: SERVER_NODE,
                      name: 'Fleet Manager',
                      baseUrl: '',
                      wsUrl: ''
                  }
              ]
    };
}

/** The node ids an existing automation already uses, so an edit keeps them. */
export function existingNodeIds(
    records: readonly FlowRecord[],
    flowId: string
): {trigger?: string; target?: string; action?: string} {
    const inside = records.filter((record) => record.z === flowId);
    const id = (record: FlowRecord | undefined) =>
        record ? String(record.id) : undefined;
    return {
        trigger: id(
            inside.find((r) => r.type === INJECT_NODE || r.type === EVENT_NODE)
        ),
        target: id(inside.find((r) => r.type === TARGET_NODE)),
        action: id(
            inside.find(
                (r) => r.operation !== undefined && r.type !== TARGET_NODE
            )
        )
    };
}

function splitCsv(value: unknown): string[] {
    return String(value ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
}

function readTrigger(record: FlowRecord | undefined): AutomationTrigger | null {
    if (!record) return null;
    if (record.type === EVENT_NODE) {
        return {kind: 'onEvents', events: splitCsv(record.events)};
    }
    if (record.type !== INJECT_NODE) return null;
    const cron = String(record.crontab ?? '');
    if (cron) return {kind: 'cron', cron};
    const seconds = Number(record.repeat);
    return Number.isFinite(seconds) && seconds > 0
        ? {kind: 'everySeconds', seconds}
        : null;
}

function readTarget(record: FlowRecord): AutomationTarget {
    return {
        deviceIds: splitCsv(record.deviceIds),
        groupIds: splitCsv(record.groupIds).map(Number).filter(Number.isFinite),
        locationIds: splitCsv(record.locationIds)
            .map(Number)
            .filter(Number.isFinite),
        tagKeys: splitCsv(record.tagKeys),
        fleet: record.fleet === true
    };
}

function readParams(value: unknown): Record<string, unknown> {
    try {
        const parsed = JSON.parse(String(value ?? '{}'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

/**
 * Reads a flow back as when / who / what, or null when it is not this shape.
 *
 * Null is a real answer: the flow was built by hand and only the editor can
 * change it safely. Guessing a recipe for it and writing that back would
 * silently delete whatever else was in there.
 */
export function readRecipe(
    records: readonly FlowRecord[],
    flowId: string
): AutomationRecipe | null {
    const tab = records.find(
        (record) => isFlowTab(record) && record.id === flowId
    );
    if (!tab) return null;
    const inside = records.filter((record) => record.z === flowId);
    if (inside.length !== 3) return null;

    const target = inside.find((record) => record.type === TARGET_NODE);
    if (!target) return null;
    const trigger = readTrigger(
        inside.find(
            (record) =>
                record.type === INJECT_NODE || record.type === EVENT_NODE
        )
    );
    if (!trigger) return null;
    const action = inside.find(
        (record) => record.operation !== undefined && record !== target
    );
    if (!action) return null;

    return {
        name: String(tab.label ?? flowId),
        when: trigger,
        who: readTarget(target),
        what: {
            method: String(action.operation),
            params: readParams(action.paramsJson)
        }
    };
}

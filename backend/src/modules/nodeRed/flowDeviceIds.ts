// Which devices a Node-RED node acts on. One home, so the device page
// ("flows that use this device") and automation.List agree. Groups, places,
// tags and the fleet are expanded in flowScopeMembers.ts.

import type {FlowRecord} from './flowClient';

/** Devices, groups, places, tags or the whole fleet one node reaches. */
export interface NodeTargetScope {
    deviceIds: string[];
    groupIds: number[];
    locationIds: number[];
    tagKeys: string[];
    fleet: boolean;
}

const NO_TARGET: NodeTargetScope = Object.freeze({
    deviceIds: [],
    groupIds: [],
    locationIds: [],
    tagKeys: [],
    fleet: false
}) as NodeTargetScope;

type ScopeReader = (record: FlowRecord) => NodeTargetScope;

// Event and trigger nodes pick one scope; fields of the others stay saved but
// hidden in the editor, so only the picked one counts.
const EVENT_SCOPES: ReadonlyMap<string, ScopeReader> = new Map<
    string,
    ScopeReader
>([
    ['all', () => ({...NO_TARGET, fleet: true})],
    [
        'devices',
        (record) => ({...NO_TARGET, deviceIds: idsFromCsv(record.deviceIds)})
    ],
    [
        'group',
        (record) => ({...NO_TARGET, groupIds: integerIds(record.groupId)})
    ],
    [
        'location',
        (record) => ({...NO_TARGET, locationIds: integerIds(record.locationId)})
    ]
]);

/** What one node reaches: its scope or target fields, plus ids in its JSON. */
export function nodeTargetScope(record: FlowRecord): NodeTargetScope {
    const declared = mergeTargetScopes([
        declaredScope(record),
        jsonTargetScope(record.paramsJson)
    ]);
    return {
        ...declared,
        deviceIds: uniqueStrings([
            ...declared.deviceIds,
            ...idsFromJsonObject(record.paramsJson),
            ...idsFromJsonObject(record.filterJson)
        ])
    };
}

/** Turns a scope into the device ids it reaches. */
export type ScopeResolver = (scope: NodeTargetScope) => string[];

/** Only devices named directly; groups, places and tags stay unexpanded. */
export const directScopeDevices: ScopeResolver = (scope) => [
    ...scope.deviceIds
];

/** One scope reaching everything the given scopes reach. */
export function mergeTargetScopes(
    scopes: readonly NodeTargetScope[]
): NodeTargetScope {
    return {
        deviceIds: uniqueStrings(scopes.flatMap((scope) => scope.deviceIds)),
        groupIds: uniqueNumbers(scopes.flatMap((scope) => scope.groupIds)),
        locationIds: uniqueNumbers(
            scopes.flatMap((scope) => scope.locationIds)
        ),
        tagKeys: uniqueStrings(scopes.flatMap((scope) => scope.tagKeys)),
        fleet: scopes.some((scope) => scope.fleet)
    };
}

function declaredScope(record: FlowRecord): NodeTargetScope {
    const pick =
        typeof record.scopeType === 'string'
            ? EVENT_SCOPES.get(record.scopeType)
            : undefined;
    return pick ? pick(record) : targetFieldsScope(record);
}

// fm-target's fields; an operation node's configured `target` uses the same.
function targetFieldsScope(record: FlowRecord): NodeTargetScope {
    return {
        deviceIds: listOf(record.deviceIds),
        groupIds: integerIds(record.groupIds),
        locationIds: integerIds(record.locationIds),
        tagKeys: listOf(record.tagKeys),
        fleet: record.fleet === true || record.fleet === 'true'
    };
}

function jsonTargetScope(value: unknown): NodeTargetScope {
    const target = parsedJson(value)?.target;
    return isRecord(target) ? targetFieldsScope(target) : NO_TARGET;
}

function parsedJson(value: unknown): FlowRecord | undefined {
    const parsed = parseJsonField(value);
    return isRecord(parsed) ? parsed : undefined;
}

// A node's JSON field as typed in the editor; broken JSON reaches nothing.
function parseJsonField(value: unknown): unknown {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    try {
        return JSON.parse(value);
    } catch {
        return undefined;
    }
}

/** A CSV string or a JSON array, as trimmed non-empty strings. */
function listOf(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map((item) => String(item).trim()).filter(Boolean);
    }
    if (typeof value === 'number') return [String(value)];
    return idsFromCsv(value);
}

function integerIds(value: unknown): number[] {
    return listOf(value)
        .filter((part) => /^\d+$/.test(part))
        .map(Number)
        .filter((id) => Number.isSafeInteger(id) && id > 0);
}

function uniqueNumbers(values: readonly number[]): number[] {
    return [...new Set(values)].sort((a, b) => a - b);
}

/** Comma-separated field to trimmed, non-empty parts. */
export function idsFromCsv(value: unknown): string[] {
    if (typeof value !== 'string') return [];
    return value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
}

function idsFromJsonObject(value: unknown): string[] {
    return deviceIdsFromValue(parseJsonField(value));
}

function deviceIdsFromValue(value: unknown): string[] {
    const ids: string[] = [];
    collectDeviceIds({value, ids, depth: 0});
    return uniqueStrings(ids);
}

function collectDeviceIds(input: {
    value: unknown;
    ids: string[];
    depth: number;
}): void {
    if (input.depth > 4) return;
    if (Array.isArray(input.value)) {
        for (const item of input.value) {
            collectDeviceIds({
                value: item,
                ids: input.ids,
                depth: input.depth + 1
            });
        }
        return;
    }
    if (!isRecord(input.value)) return;
    collectRecordDeviceIds(input.value, input.ids);
    for (const value of Object.values(input.value)) {
        collectDeviceIds({value, ids: input.ids, depth: input.depth + 1});
    }
}

function collectRecordDeviceIds(record: FlowRecord, ids: string[]): void {
    for (const key of deviceIdKeys()) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) ids.push(value.trim());
        if (Array.isArray(value)) ids.push(...value.filter(isNonEmptyString));
    }
}

function deviceIdKeys(): readonly string[] {
    return [
        'shellyID',
        'shellyIDs',
        'deviceId',
        'deviceIds',
        'externalId',
        'externalIds'
    ];
}

function uniqueStrings(values: readonly string[]): string[] {
    return [...new Set(values.filter(isNonEmptyString))].sort((a, b) =>
        a.localeCompare(b)
    );
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is FlowRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

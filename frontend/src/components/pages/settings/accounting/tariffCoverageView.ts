// Which tariff wins for a device or a channel: what to ask
// tariff.ResolveAssignments, and how to write the answer. Pure functions only.

import type {DataColumn} from '@/components/core/DataList.vue';
import {deviceChannelNumbers} from '@/helpers/utilityAccounting';
import type {
    HostParams,
    HostResult
} from '@/shell/template-host/generated/contract';
import type {ApiLocation} from '@/stores/locations';
import type {shelly_device_t} from '@/types/device';
import {
    type Assignment,
    type Commodity,
    DIRECTIONS,
    type Direction,
    deviceName,
    type Tariff,
    tariffName
} from './tariffAssignmentView';

export type Resolution =
    HostResult<'tariff.resolveassignments'>['items'][number];

/** One question: which tariff wins for this device, or for this channel. */
export interface CoveragePoint {
    device: shelly_device_t;
    channel: number | null;
}

export interface CoverageRow {
    key: string;
    name: string;
    channel: number | null;
    importAnswer: Resolution | null;
    exportAnswer: Resolution | null;
}

export interface CoveragePlan {
    points: CoveragePoint[];
    checkedDevices: number;
}

export const COVERAGE_COLUMNS: DataColumn<CoverageRow>[] = [
    {key: 'device', label: 'Device', role: 'primary'},
    {key: 'importTariff', label: 'Import tariff', role: 'meta'},
    {key: 'exportTariff', label: 'Export tariff', role: 'meta'}
];

const COVERAGE_SOURCE_LABELS = {
    organization: 'From the organization default',
    location: 'From the location assignment',
    device: 'From the device assignment',
    channel: 'From the channel assignment'
};

// tariff.ResolveAssignments takes at most 1000 points per call.
const COVERAGE_POINT_LIMIT = 1000;

/** The channels that carry their own tariff, by device. */
export function channelOverrides(
    assignments: readonly Assignment[],
    commodity: Commodity
): Map<string, number[]> {
    const byDevice = new Map<string, number[]>();
    for (const row of assignments) {
        if (row.scopeLevel !== 'channel') continue;
        if (row.commodity !== commodity) continue;
        if (row.deviceExternalId === null || row.channel === null) continue;
        const channels = byDevice.get(row.deviceExternalId);
        if (channels) channels.push(row.channel);
        else byDevice.set(row.deviceExternalId, [row.channel]);
    }
    return byDevice;
}

export function coveragePlan(
    devices: readonly shelly_device_t[],
    overrides: ReadonlyMap<string, number[]>
): CoveragePlan {
    const points: CoveragePoint[] = [];
    let checkedDevices = 0;
    for (const device of devices) {
        const next = devicePoints(device, overrides.get(device.shellyID) ?? []);
        const asked = (points.length + next.length) * DIRECTIONS.length;
        if (asked > COVERAGE_POINT_LIMIT) break;
        points.push(...next);
        checkedDevices += 1;
    }
    return {points, checkedDevices};
}

export function resolutionPoints(
    points: readonly CoveragePoint[],
    commodity: Commodity
): HostParams<'tariff.resolveassignments'>['points'] {
    return points.flatMap((point) =>
        DIRECTIONS.map((option) => ({
            deviceExternalId: point.device.shellyID,
            channel: point.channel,
            commodity,
            direction: option.value
        }))
    );
}

export function coverageRowsFrom(
    points: readonly CoveragePoint[],
    answers: readonly Resolution[]
): CoverageRow[] {
    const byPoint = new Map(
        answers.map((answer) => [
            answerKey(
                answer.deviceExternalId,
                answer.channel,
                answer.direction
            ),
            answer
        ])
    );
    return points.map((point) => ({
        key: `${point.device.shellyID}:${point.channel}`,
        name: deviceName(point.device),
        channel: point.channel,
        importAnswer: pointAnswer(byPoint, point, 'import'),
        exportAnswer: pointAnswer(byPoint, point, 'export')
    }));
}

export function isAmbiguous(row: CoverageRow): boolean {
    return (
        row.importAnswer?.ambiguous === true ||
        row.exportAnswer?.ambiguous === true
    );
}

export function coverageTariffLabel(
    answer: Resolution | null,
    tariffs: readonly Tariff[]
): string {
    if (!answer) return 'Unavailable';
    if (answer.ambiguous) {
        return answer.channel === null ? 'No single answer' : 'Ambiguous';
    }
    if (answer.tariffId === null) return 'No tariff';
    return tariffName(tariffs, answer.tariffId);
}

export function coverageSourceLabel(
    answer: Resolution | null,
    locations: readonly ApiLocation[]
): string {
    if (!answer || answer.scopeLevel === null) return '';
    const label = COVERAGE_SOURCE_LABELS[answer.scopeLevel];
    if (answer.scopeLevel !== 'location') return label;
    return `${label}: ${locationName(locations, answer.locationId)}`;
}

export function childLocationsOf(
    locations: readonly ApiLocation[]
): Map<number, number[]> {
    const byParent = new Map<number, number[]>();
    for (const location of locations) {
        const parent = location.parentLocationId;
        if (parent === null || parent === undefined) continue;
        const children = byParent.get(parent);
        if (children) children.push(location.id);
        else byParent.set(parent, [location.id]);
    }
    return byParent;
}

// A location assignment reaches every device below it, not only its own.
export function locationWithDescendants(
    childLocations: ReadonlyMap<number, number[]>,
    rootId: number
): Set<number> {
    const covered = new Set<number>();
    if (!Number.isInteger(rootId)) return covered;
    const pending = [rootId];
    while (pending.length > 0) {
        const id = pending.pop();
        if (id === undefined || covered.has(id)) continue;
        covered.add(id);
        pending.push(...(childLocations.get(id) ?? []));
    }
    return covered;
}

// A device with channel assignments has no single device-wide answer.
function devicePoints(
    device: shelly_device_t,
    overridden: readonly number[]
): CoveragePoint[] {
    if (overridden.length === 0) return [{device, channel: null}];
    const known = new Set([
        ...deviceChannelNumbers(device.status),
        ...overridden
    ]);
    return [...known]
        .sort((a, b) => a - b)
        .map((channel) => ({device, channel}));
}

function pointAnswer(
    byPoint: ReadonlyMap<string, Resolution>,
    point: CoveragePoint,
    direction: Direction
): Resolution | null {
    const key = answerKey(point.device.shellyID, point.channel, direction);
    return byPoint.get(key) ?? null;
}

function answerKey(
    deviceExternalId: string,
    channel: number | null,
    direction: Direction
): string {
    return `${deviceExternalId}:${channel}:${direction}`;
}

function locationName(
    locations: readonly ApiLocation[],
    id: number | null
): string {
    if (id === null) return 'unknown location';
    return (
        locations.find((location) => location.id === id)?.name ??
        `Location ${id}`
    );
}

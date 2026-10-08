// What a tariff assignment is: the words the panel shows for one, and the
// payload tariff.Assign takes for it. Pure throughout, so the panel and its
// children keep every piece of state and every call.

import type {DataColumn} from '@/components/core/DataList.vue';
import type {
    HostParams,
    HostResult
} from '@/shell/template-host/generated/contract';

export type Tariff = HostResult<'tariff.list'>['items'][number];
export type Assignment = HostResult<'tariff.listassignments'>['items'][number];
export type Direction = 'import' | 'export';
export type Commodity = Tariff['commodity'];
export type ScopeLevel = 'organization' | 'location' | 'device' | 'channel';

export const DIRECTIONS = [
    {value: 'import' as const, label: 'Import / consumption'},
    {value: 'export' as const, label: 'Export / return'}
];

/** The one shape both writes share: assign upserts it, remove adds delete. */
export interface AssignmentTarget {
    tariffId: number;
    scopeLevel: ScopeLevel;
    direction: Direction;
    locationId: number | null;
    deviceExternalId: string | null;
    channel: number | null;
}

/** The form while it is being filled in: raw picker values, still empty until
 *  the operator chooses. */
export interface AssignmentDraft {
    tariffId: number | null;
    scopeLevel: ScopeLevel;
    locationId: string | number;
    deviceExternalId: string;
    channel: string | number;
}

export interface DraftIssues {
    tariff: string;
    target: string;
    channel: string;
}

export const ASSIGNMENT_COLUMNS: DataColumn<Assignment>[] = [
    {key: 'tariff', label: 'Tariff', role: 'primary'},
    {key: 'commodity', label: 'Commodity / unit', role: 'secondary'},
    {key: 'direction', label: 'Direction', role: 'status'},
    {key: 'scope', label: 'Assignment scope', role: 'meta'},
    {key: 'actions', label: '', role: 'action', align: 'right'}
];

export function findTariff(
    tariffs: readonly Tariff[],
    id: number | null
): Tariff | undefined {
    return tariffs.find((tariff) => tariff.id === id);
}

export function tariffName(tariffs: readonly Tariff[], id: number): string {
    return findTariff(tariffs, id)?.name ?? `Tariff ${id}`;
}

export function assignmentScope(row: Assignment): string {
    if (row.scopeLevel === 'organization') return 'Organization default';
    if (row.scopeLevel === 'location')
        return `Location ${row.locationId ?? 'unknown'}`;
    if (row.scopeLevel === 'dashboard')
        return `Legacy dashboard ${row.dashboardId ?? 'unknown'}`;
    if (row.scopeLevel === 'device')
        return `Device ${row.deviceExternalId ?? 'unknown'}`;
    return `Device ${row.deviceExternalId ?? 'unknown'}, channel ${row.channel ?? 'unknown'}`;
}

export function assignmentKey(row: Assignment): string {
    return [
        row.direction,
        row.scopeLevel,
        row.locationId,
        row.dashboardId,
        row.deviceExternalId,
        row.channel,
        row.tariffId
    ].join(':');
}

export function canRemove(row: Assignment): boolean {
    return row.scopeLevel !== 'dashboard';
}

export function directionExplanation(
    direction: Direction,
    commodity: Commodity
): string {
    if (direction === 'import') {
        return 'Import tariffs price consumption drawn from the utility.';
    }
    return commodity === 'gas'
        ? 'Export tariffs pay you for gas you send back. What you buy is still charged.'
        : 'Export tariffs value measured returned electricity as a separate credit path; they do not replace import charges.';
}

export function scopeSummary(draft: AssignmentDraft): string {
    if (draft.scopeLevel === 'organization') return 'Organization default';
    if (draft.scopeLevel === 'location')
        return `Location ${draft.locationId || 'not selected'}`;
    if (draft.scopeLevel === 'device')
        return `Device ${draft.deviceExternalId || 'not selected'}`;
    return `Device ${draft.deviceExternalId || 'not selected'}, channel ${draft.channel === '' ? 'not selected' : draft.channel}`;
}

export function reviewImpact(scopeLevel: ScopeLevel): string {
    if (scopeLevel === 'organization') {
        return 'Every device without its own tariff will use this one.';
    }
    if (scopeLevel === 'location') {
        return 'Matching points in this location may inherit it; device and channel overrides are preserved.';
    }
    if (scopeLevel === 'device') {
        return 'Matching points on this device may inherit it; channel overrides are preserved.';
    }
    return 'Only this exact device channel changes.';
}

/** The first thing wrong with the draft, on the field that owns it. The form
 *  shows one problem at a time. */
export function draftIssues(
    draft: AssignmentDraft,
    tariffs: readonly Tariff[]
): DraftIssues {
    const issues: DraftIssues = {tariff: '', target: '', channel: ''};
    if (!findTariff(tariffs, draft.tariffId)) {
        issues.tariff = 'Select a matching tariff.';
        return issues;
    }
    if (draft.scopeLevel === 'location' && Number(draft.locationId) < 1) {
        issues.target = 'Enter a valid location ID.';
        return issues;
    }
    if (namesADevice(draft.scopeLevel) && !draft.deviceExternalId.trim()) {
        issues.target = 'Enter the exact device identifier.';
        return issues;
    }
    if (draft.scopeLevel === 'channel' && !isChannelNumber(draft.channel)) {
        issues.channel = 'Channel must be zero or a positive integer.';
    }
    return issues;
}

export function hasIssue(issues: DraftIssues): boolean {
    return (
        issues.tariff !== '' || issues.target !== '' || issues.channel !== ''
    );
}

export function draftTarget(
    draft: AssignmentDraft,
    direction: Direction
): AssignmentTarget | null {
    if (draft.tariffId == null) return null;
    return {
        tariffId: draft.tariffId,
        scopeLevel: draft.scopeLevel,
        direction,
        locationId: Number(draft.locationId),
        deviceExternalId: draft.deviceExternalId.trim(),
        channel: Number(draft.channel)
    };
}

export function assignRequest(
    target: AssignmentTarget
): HostParams<'tariff.assign'> {
    const request: HostParams<'tariff.assign'> = {
        tariffId: target.tariffId,
        scopeLevel: target.scopeLevel,
        direction: target.direction
    };
    if (target.scopeLevel === 'location')
        request.locationId = target.locationId;
    if (namesADevice(target.scopeLevel)) {
        request.deviceExternalId = target.deviceExternalId;
    }
    if (target.scopeLevel === 'channel') request.channel = target.channel;
    return request;
}

export function removalRequest(row: Assignment): HostParams<'tariff.assign'> {
    if (row.scopeLevel === 'dashboard') {
        throw new Error(
            'A legacy dashboard assignment cannot be removed here.'
        );
    }
    const request = assignRequest({
        tariffId: row.tariffId,
        scopeLevel: row.scopeLevel,
        direction: row.direction,
        locationId: row.locationId,
        deviceExternalId: row.deviceExternalId,
        channel: row.channel
    });
    return {...request, delete: true};
}

export function titleCase(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1).replaceAll('_', ' ');
}

export function deviceName(device: {
    info?: {name?: string; model?: string};
}): string {
    return device.info?.name || device.info?.model || 'Unnamed device';
}

function namesADevice(scopeLevel: ScopeLevel): boolean {
    return scopeLevel === 'device' || scopeLevel === 'channel';
}

function isChannelNumber(value: string | number): boolean {
    return Number.isInteger(Number(value)) && Number(value) >= 0;
}

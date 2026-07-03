import type {ShellyDeviceExternal} from '../../types';
import * as DeviceCollector from '../DeviceCollector';
import * as postgres from '../PostgresProvider';
import type {
    DeviceMemberships,
    OrganizationRelationshipLoadInput,
    RelationshipLoadInput
} from './relationshipTypes';

export function deviceLabel(row: ShellyDeviceExternal): string {
    const name = (row.info as {name?: unknown})?.name;
    return typeof name === 'string' && name.trim() ? name : row.shellyID;
}

export function deviceLabelForExternalId(externalId: string): string {
    const liveDevice = DeviceCollector.getDevice(externalId);
    return liveDevice ? deviceLabel(liveDevice.toJSON()) : externalId;
}

// Generic over any relationship input that carries an org scope, so both the
// full load input and the lighter connector input share one guard.
export function requireOrganization<
    T extends {organizationId: string | undefined}
>(input: T): T & {organizationId: string} {
    if (!input.organizationId) {
        throw new Error('device relationship organization scope is required');
    }
    return {...input, organizationId: input.organizationId};
}

export async function filterAccessibleExternalIds(
    input: {
        centerExternalId: string;
        filterAccessibleDevices?: (
            externalIds: readonly string[]
        ) => Promise<Set<string>>;
    },
    externalIds: Iterable<string>
): Promise<Set<string>> {
    const ids = [...new Set(externalIds)].filter(
        (id) => id !== input.centerExternalId
    );
    if (!input.filterAccessibleDevices) return new Set(ids);
    return await input.filterAccessibleDevices(ids);
}

export function centerEntityIds(input: RelationshipLoadInput): string[] {
    const liveDevice = DeviceCollector.getDevice(input.centerExternalId);
    if (!liveDevice) return [];
    return liveDevice
        .toJSON()
        .entities.filter(
            (entity): entity is string => typeof entity === 'string'
        );
}

export async function loadCenterMemberships(
    input: OrganizationRelationshipLoadInput
): Promise<DeviceMemberships> {
    const rows = await postgres.listDeviceMemberships(input.organizationId);
    const row = rows.find((item) => item.subject_id === input.centerExternalId);
    return {
        groupIds: row?.group_ids ?? [],
        locationId: row?.location_id ?? null,
        tagIds: row?.tag_ids ?? []
    };
}

export function readRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

export function stringValue(...values: unknown[]): string | undefined {
    return values.find(
        (value): value is string => typeof value === 'string' && value !== ''
    );
}

export function stringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const strings = value.filter(
        (item): item is string => typeof item === 'string'
    );
    return strings.length > 0 ? strings : undefined;
}

export function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function finiteNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
        ? value
        : undefined;
}

export function objectRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

export function uniqueNumbers(values: readonly number[]): number[] {
    return [...new Set(values)].sort((a, b) => a - b);
}

export function nullableString(value: number | null): string | null {
    return value === null ? null : String(value);
}

export function readArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

export function readScopeIds(value: unknown): string[] {
    return readArray(value)
        .map((entry) => String(entry).trim())
        .filter(Boolean);
}

export function locationScopeIds(memberships: DeviceMemberships): string[] {
    return memberships.locationId === null
        ? []
        : [String(memberships.locationId)];
}

export function uniqueMembershipIds(ids: readonly number[]): number[] {
    return Array.from(new Set(ids)).sort((a, b) => a - b);
}

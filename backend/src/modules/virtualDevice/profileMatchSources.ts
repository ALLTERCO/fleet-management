// Score device components against a profile's role slots.

import {bthomeObjectInfos} from '../../config/BTHomeData';
import {tuning} from '../../config/tuning';
import RpcError from '../../rpc/RpcError';
import type {
    BluetoothDeviceDto,
    BluetoothSourceComponentDto,
    VirtualDeviceProfileDto,
    VirtualDeviceProfileMatchDto,
    VirtualDeviceProfileMatchSlotDto,
    VirtualDeviceProfileMatchSourcesDto,
    VirtualDeviceProfileMatchSourcesParams,
    VirtualDeviceProfileRole
} from '../../types/api/virtualdevice';
import * as postgres from '../PostgresProvider';
import {listBluetoothDevices} from './bluetoothRepository';
import {canonicalBTHomeComponentType} from './bthomeRemap';
import {
    classifySourceComponent,
    collectBindableComponentKeys
} from './sourceClassifier';

interface MatchDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
    // Returns the subset of externalIds the caller may see; undefined =
    // bypass (used by tests + cross-org-boundary callers).
    filterAccessible?(externalIds: readonly string[]): Promise<Set<string>>;
    // Test injection point for the BLU repo call so unit tests can serve
    // BLU candidates without touching live postgres.
    listBluetoothPage?(
        organizationId: string
    ): Promise<{items: readonly BluetoothDeviceDto[]}>;
}

interface CandidateDeviceRow {
    id: number;
    external_id: string;
    kind: string | null;
    jdoc: Record<string, unknown> | null;
}

const MAX_MATCHES_PER_SLOT = tuning.virtualDevice.profileMatchMaxPerSlot;

const defaultDeps: MatchDeps = {
    queryRows: postgres.queryRows
};

export async function matchVirtualDeviceProfileSources(
    organizationId: string,
    input: VirtualDeviceProfileMatchSourcesParams,
    deps: MatchDeps = defaultDeps
): Promise<VirtualDeviceProfileMatchSourcesDto> {
    const profile = await resolveProfile(organizationId, input, deps);
    const allCandidates = await listCandidateDevices(
        organizationId,
        input,
        deps
    );
    const accessible = await keepAccessible(
        allCandidates,
        (c) => c.external_id,
        deps
    );
    const bluAll = await keepAccessible(
        await listBluCandidates(organizationId, input, deps),
        (b) => b.externalId,
        deps
    );
    // Paginate physical + BLU as one window so `limit` reflects total
    // candidates considered, not just physical. Physical comes first in
    // the combined list, so `limit=N` with mixed results returns physical
    // before BLU; `offset` skips physical first, then spills into BLU.
    const combined = applyPagination(
        [
            ...accessible.map((c) => ({kind: 'physical' as const, row: c})),
            ...bluAll.map((b) => ({kind: 'blu' as const, row: b}))
        ],
        input
    );
    const physicalCandidates = combined
        .filter((e) => e.kind === 'physical')
        .map((e) => e.row as CandidateDeviceRow);
    const bluCandidates = combined
        .filter((e) => e.kind === 'blu')
        .map((e) => e.row as BluetoothDeviceDto);
    const slots = profile.roles.map((role) =>
        scoreSlot(role, physicalCandidates, bluCandidates)
    );
    const fillFromDevice = buildFillFromDevice(profile.roles, slots);
    return {
        profile: {
            id: profile.id,
            key: profile.key,
            name: profile.name,
            version: profile.version
        },
        slots,
        fillFromDevice
    };
}

interface ProfileRow {
    id: string;
    organization_id: string | null;
    key: string;
    name: string;
    version: number;
    roles_json: VirtualDeviceProfileRole[];
    metadata: Record<string, unknown> | null;
}

async function resolveProfile(
    organizationId: string,
    input: VirtualDeviceProfileMatchSourcesParams,
    deps: MatchDeps
): Promise<VirtualDeviceProfileDto> {
    if (!input.profileId && !input.profileKey) {
        throw RpcError.InvalidParams('profileId or profileKey is required', [
            {field: 'profileId', error: 'missing', code: 'missing_profile'}
        ]);
    }
    const values: unknown[] = [organizationId];
    const where = [
        '(organization_id = $1 OR organization_id IS NULL)',
        'deleted_at IS NULL'
    ];
    if (input.profileId) {
        values.push(input.profileId);
        where.push(`id = $${values.length}`);
    }
    if (input.profileKey) {
        values.push(input.profileKey);
        where.push(`key = $${values.length}`);
    }
    if (input.profileVersion) {
        values.push(input.profileVersion);
        where.push(`version = $${values.length}`);
    }
    // Org-owned wins over system; highest version wins within tier.
    const rows = await deps.queryRows<ProfileRow>(
        `SELECT id, organization_id, key, name, version, roles_json, metadata
           FROM device.virtual_device_profile
          WHERE ${where.join(' AND ')}
          ORDER BY CASE WHEN organization_id = $1 THEN 0 ELSE 1 END,
                   version DESC
          LIMIT 1`,
        values
    );
    const row = rows[0];
    if (!row) {
        throw RpcError.NotFound(
            'virtual_device_profile',
            input.profileId ?? input.profileKey ?? ''
        );
    }
    return {
        id: row.id,
        organizationId: row.organization_id,
        key: row.key,
        name: row.name,
        version: row.version,
        roles: row.roles_json ?? [],
        metadata: (row.metadata ?? {}) as VirtualDeviceProfileDto['metadata']
    };
}

async function listCandidateDevices(
    organizationId: string,
    input: VirtualDeviceProfileMatchSourcesParams,
    deps: MatchDeps
): Promise<CandidateDeviceRow[]> {
    const values: unknown[] = [organizationId];
    const where = ['dl.organization_id = $1', 'vd.device_list_id IS NULL'];
    if (input.deviceExternalId) {
        values.push(input.deviceExternalId);
        where.push(`dl.external_id = $${values.length}`);
    } else if (
        input.sourceDeviceExternalIds &&
        input.sourceDeviceExternalIds.length > 0
    ) {
        values.push(input.sourceDeviceExternalIds);
        where.push(`dl.external_id = ANY($${values.length}::varchar[])`);
    }
    if (input.query) {
        values.push(`%${input.query}%`);
        where.push(
            `(dl.external_id ILIKE $${values.length} OR dl.jdoc->'info'->>'name' ILIKE $${values.length})`
        );
    }
    return deps.queryRows<CandidateDeviceRow>(
        `SELECT dl.id, dl.external_id, dl.kind, dl.jdoc
           FROM device.list dl
      LEFT JOIN device.virtual_device vd
             ON vd.device_list_id = dl.id
            AND vd.organization_id = dl.organization_id
          WHERE ${where.join(' AND ')}
          ORDER BY dl.external_id ASC`,
        values
    );
}

// Drop entries the sender cannot see. Same per-group ACL applies to
// physical + BLU; deps.filterAccessible bypasses for cross-org callers.
async function keepAccessible<T>(
    items: readonly T[],
    externalIdOf: (item: T) => string,
    deps: MatchDeps
): Promise<T[]> {
    if (!deps.filterAccessible || items.length === 0) return [...items];
    const allowed = await deps.filterAccessible(items.map(externalIdOf));
    return items.filter((item) => allowed.has(externalIdOf(item)));
}

function applyPagination<T>(
    items: readonly T[],
    input: VirtualDeviceProfileMatchSourcesParams
): T[] {
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 200;
    if (limit === 0) return items.slice(offset);
    return items.slice(offset, offset + limit);
}

async function listBluCandidates(
    organizationId: string,
    input: VirtualDeviceProfileMatchSourcesParams,
    deps: MatchDeps
): Promise<BluetoothDeviceDto[]> {
    if (input.deviceExternalId && !input.deviceExternalId.startsWith('blu_')) {
        return [];
    }
    const fetchPage =
        deps.listBluetoothPage ??
        ((orgId: string) => listBluetoothDevices(orgId, {limit: 0}));
    // BLU repo failures must not break profile matching on physical devices.
    let items: readonly BluetoothDeviceDto[];
    try {
        const page = await fetchPage(organizationId);
        items = page.items;
    } catch {
        return [];
    }
    const wanted = new Set(input.sourceDeviceExternalIds ?? []);
    return items.filter((blu) => {
        if (input.deviceExternalId) {
            return blu.externalId === input.deviceExternalId;
        }
        if (wanted.size > 0) return wanted.has(blu.externalId);
        return true;
    });
}

function scoreSlot(
    role: VirtualDeviceProfileRole,
    candidates: readonly CandidateDeviceRow[],
    bluCandidates: readonly BluetoothDeviceDto[]
): VirtualDeviceProfileMatchSlotDto {
    const matches: VirtualDeviceProfileMatchDto[] = [];
    for (const candidate of candidates) {
        const jdoc = candidate.jdoc ?? {};
        const componentKeys = collectBindableComponentKeys({jdoc});
        for (const componentKey of componentKeys) {
            const classification = classifySourceComponent({
                deviceExternalId: candidate.external_id,
                deviceKind: candidate.kind,
                jdoc,
                componentKey
            });
            const scored = scoreCandidate(role, classification);
            if (scored.score <= 0) continue;
            matches.push({
                deviceExternalId: candidate.external_id,
                deviceName: deviceName(candidate),
                componentKey,
                componentType: classification.componentType,
                label: classification.label,
                score: scored.score,
                reasons: scored.reasons
            });
        }
    }
    for (const blu of bluCandidates) {
        for (const component of blu.components) {
            if (component.role === 'identity') continue;
            const classification = classifyBluComponent(component);
            const scored = scoreCandidate(role, classification);
            if (scored.score <= 0) continue;
            matches.push({
                deviceExternalId: blu.externalId,
                deviceName: blu.productName ?? blu.externalId,
                componentKey: component.componentKey,
                componentType: classification.componentType,
                label: classification.label,
                score: scored.score,
                reasons: scored.reasons
            });
        }
    }
    matches.sort((a, b) => b.score - a.score);
    return {
        roleKey: role.roleKey,
        label: role.label,
        valueType: role.valueType,
        unit: role.unit ?? null,
        writable: role.writable === true,
        required: role.required !== false,
        matches: matches.slice(0, MAX_MATCHES_PER_SLOT)
    };
}

// Map a BLU sensor/control to the same classifier shape physical components
// use, so scoring is unified across both paths.
export function classifyBluComponent(
    component: BluetoothSourceComponentDto
): ReturnType<typeof classifySourceComponent> {
    const rawType = component.componentKey.split(':')[0] ?? 'bthomesensor';
    if (component.kind === 'trv') {
        return {
            componentKey: component.componentKey,
            componentType: 'blutrv',
            rawComponentType: rawType,
            sourceFamily: 'BTHome',
            roleValueType: 'json',
            writable: component.canWrite,
            label: component.name,
            unit: undefined,
            objectId: component.objectId,
            sourceHints: {
                actions: ['setTarget', 'setEnabled', 'startBoost', 'clearBoost']
            }
        };
    }
    const objInfo =
        component.objectId !== null
            ? bthomeObjectInfos[component.objectId]
            : undefined;
    const remapped = objInfo
        ? canonicalBTHomeComponentType(objInfo.name)
        : undefined;
    const componentType = remapped ?? rawType;
    const roleValueType = roleValueTypeFor(componentType, objInfo);
    return {
        componentKey: component.componentKey,
        componentType,
        rawComponentType: rawType,
        sourceFamily: 'BTHome',
        roleValueType,
        writable: component.canWrite,
        label: component.name,
        unit: objInfo?.unit || undefined,
        objectId: component.objectId,
        sourceHints: objInfo
            ? {objName: objInfo.name, rawType: objInfo.type}
            : {}
    };
}

function roleValueTypeFor(
    componentType: string,
    objInfo: {type: string} | undefined
): ReturnType<typeof classifySourceComponent>['roleValueType'] {
    if (componentType === 'button') return 'event';
    if (
        componentType === 'motion' ||
        componentType === 'flood' ||
        componentType === 'door' ||
        componentType === 'smoke' ||
        componentType === 'gas' ||
        componentType === 'carbon_monoxide' ||
        componentType === 'tamper' ||
        componentType === 'vibration' ||
        componentType === 'presence' ||
        componentType === 'garage_door' ||
        componentType === 'lock' ||
        componentType === 'sound'
    ) {
        return 'boolean';
    }
    if (objInfo?.type === 'binary_sensor') return 'boolean';
    return 'number';
}

export interface CandidateScore {
    score: number;
    reasons: string[];
}

export function scoreCandidate(
    role: VirtualDeviceProfileRole,
    classification: ReturnType<typeof classifySourceComponent>
): CandidateScore {
    const reasons: string[] = [];
    let score = 0;
    const profileType = profileComponentType(role);

    if (profileType && profileType === classification.componentType) {
        score += 0.5;
        reasons.push('component type match');
    } else if (profileType && profileType === classification.rawComponentType) {
        score += 0.35;
        reasons.push('raw component type match');
    } else if (role.valueType === classification.roleValueType) {
        score += 0.25;
        reasons.push('value type match');
    } else {
        return {score: 0, reasons: []};
    }

    if (role.valueType === classification.roleValueType) {
        score += 0.15;
        if (!reasons.includes('value type match')) {
            reasons.push('value type match');
        }
    }

    if (role.writable === true && !classification.writable) {
        return {score: 0, reasons: []};
    }
    if (role.writable === true && classification.writable) {
        score += 0.1;
        reasons.push('writable compatible');
    }

    if (role.unit && classification.unit && role.unit === classification.unit) {
        score += 0.1;
        reasons.push('unit match');
    }

    if (
        role.label &&
        classification.label &&
        labelSimilarity(role.label, classification.label)
    ) {
        score += 0.05;
        reasons.push('label hint');
    }

    return {score: Math.min(score, 1), reasons};
}

function profileComponentType(role: VirtualDeviceProfileRole): string | null {
    const meta = role.metadata as
        | {componentType?: string; entityType?: string}
        | undefined;
    return meta?.componentType ?? meta?.entityType ?? null;
}

function labelSimilarity(a: string, b: string): boolean {
    const norm = (s: string) => s.trim().toLowerCase();
    const left = norm(a);
    const right = norm(b);
    return left === right || left.includes(right) || right.includes(left);
}

function buildFillFromDevice(
    roles: readonly VirtualDeviceProfileRole[],
    slots: readonly VirtualDeviceProfileMatchSlotDto[]
): VirtualDeviceProfileMatchSourcesDto['fillFromDevice'] {
    const requiredCount = roles.filter((r) => r.required !== false).length;
    if (requiredCount === 0) return [];
    const byDevice = new Map<
        string,
        {
            assignments: {roleKey: string; componentKey: string}[];
            required: number;
        }
    >();
    for (const slot of slots) {
        if (!slot.required || slot.matches.length === 0) continue;
        const grouped = new Map<string, VirtualDeviceProfileMatchDto>();
        for (const match of slot.matches) {
            const prior = grouped.get(match.deviceExternalId);
            if (!prior || match.score > prior.score) {
                grouped.set(match.deviceExternalId, match);
            }
        }
        for (const [deviceId, match] of grouped) {
            const bucket = byDevice.get(deviceId) ?? {
                assignments: [],
                required: 0
            };
            bucket.assignments.push({
                roleKey: slot.roleKey,
                componentKey: match.componentKey
            });
            bucket.required += 1;
            byDevice.set(deviceId, bucket);
        }
    }
    return [...byDevice.entries()]
        .map(([deviceExternalId, value]) => ({
            deviceExternalId,
            matchedRequired: value.required,
            totalRequired: requiredCount,
            assignments: value.assignments
        }))
        .sort((a, b) => b.matchedRequired - a.matchedRequired);
}

function deviceName(row: CandidateDeviceRow): string {
    const jdoc = (row.jdoc ?? {}) as Record<string, unknown>;
    const info = (jdoc.info as {name?: string}) ?? {};
    if (typeof info.name === 'string' && info.name.trim().length > 0) {
        return info.name.trim();
    }
    return row.external_id;
}

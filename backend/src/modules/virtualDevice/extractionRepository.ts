import {randomUUID} from 'node:crypto';
import RpcError from '../../rpc/RpcError';
import type {
    VirtualDeviceDto,
    VirtualDeviceExtractionCreateParams,
    VirtualDeviceExtractionPreviewDto,
    VirtualDeviceExtractionPreviewParams,
    VirtualDeviceExtractionReplacementPreviewDto,
    VirtualDeviceExtractionReplacementPreviewParams,
    VirtualDeviceExtractionRoleDto
} from '../../types/api/virtualdevice';
import {assertAssetBelongsToOrg} from '../asset/assetRepository';
import * as postgres from '../PostgresProvider';
import {
    getVirtualDeviceByListId,
    makeVirtualExternalId,
    type QueryClient,
    replaceVirtualDeviceMemberships
} from './repository';
import {classifySourceComponent} from './sourceClassifier';

interface ExtractionRepositoryDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
    withTransaction<T>(fn: (client: QueryClient) => Promise<T>): Promise<T>;
    makeExternalId(): string;
    makeId(): string;
}

interface HostDeviceRow {
    id: number;
    external_id: string;
    jdoc: Record<string, unknown> | null;
}

interface ExistingExtractionRow {
    external_id: string;
}

export interface ExtractionMemberSnapshot {
    roleKey: string;
    componentKey: string;
    componentType: string;
    valueType: 'boolean' | 'number' | 'string' | 'event' | 'json';
    writable: boolean;
    required: boolean;
    unit: string | null;
    label: string | null;
}

interface ExtractionSource {
    preview: Omit<
        VirtualDeviceExtractionPreviewDto,
        'alreadyExtracted' | 'extractedExternalId' | 'sourceSnapshot'
    >;
    members: ExtractionMemberSnapshot[];
}

const VIRTUAL_COMPONENT_TYPES = new Set([
    'boolean',
    'number',
    'text',
    'enum',
    'button',
    'group',
    'object'
]);

const defaultDeps: ExtractionRepositoryDeps = {
    queryRows: postgres.queryRows,
    withTransaction: postgres.withQueryTransaction,
    makeExternalId: makeVirtualExternalId,
    makeId: randomUUID
};
const CREATE_COLLISION_RETRIES = 5;

export async function previewExtractedDevice(
    organizationId: string,
    input: VirtualDeviceExtractionPreviewParams,
    deps: ExtractionRepositoryDeps = defaultDeps
): Promise<VirtualDeviceExtractionPreviewDto> {
    const host = await requireHostDevice(
        deps,
        organizationId,
        input.hostExternalId
    );
    const source = buildExtractionSource(host, input.sourceKey);
    const existing = await findExistingExtraction(
        deps,
        organizationId,
        host.external_id,
        input.sourceKey
    );
    return addExistingExtraction(source.preview, source.members, existing);
}

export async function previewExtractionReplacement(
    organizationId: string,
    input: VirtualDeviceExtractionReplacementPreviewParams,
    deps: ExtractionRepositoryDeps = defaultDeps
): Promise<VirtualDeviceExtractionReplacementPreviewDto> {
    const currentBindings = await loadCurrentRoleBindings(
        organizationId,
        input.externalId,
        deps
    );
    if (currentBindings.length === 0) {
        throw RpcError.NotFound('virtual_device', input.externalId);
    }
    const newHost = await requireHostDevice(
        deps,
        organizationId,
        input.newHostExternalId
    );
    const candidate = buildExtractionSource(newHost, input.newSourceKey);
    const candidateByRoleKey = new Map(
        candidate.members.map((m) => [m.roleKey, m])
    );
    const candidateByComponentKey = new Map(
        candidate.members.map((m) => [m.componentKey, m])
    );
    const claimedCandidates = new Set<string>();

    const roleMatches: VirtualDeviceExtractionReplacementPreviewDto['roleMatches'] =
        [];
    const roleMissing: string[] = [];
    const warnings: string[] = [];
    for (const current of currentBindings) {
        const currentType =
            current.source_component_key.split(':')[0] ?? 'component';
        const match =
            pickUnclaimed(
                candidateByRoleKey.get(current.role_key),
                claimedCandidates
            ) ??
            pickUnclaimed(
                candidateByComponentKey.get(current.source_component_key),
                claimedCandidates
            ) ??
            pickUnclaimed(
                candidate.members.find(
                    (m) =>
                        !claimedCandidates.has(m.componentKey) &&
                        m.componentType === currentType &&
                        (current.value_type === null ||
                            m.valueType === current.value_type)
                ),
                claimedCandidates
            ) ??
            pickUnclaimed(
                candidate.members.find(
                    (m) =>
                        !claimedCandidates.has(m.componentKey) &&
                        current.value_type !== null &&
                        m.valueType === current.value_type
                ),
                claimedCandidates
            );
        if (!match) {
            roleMissing.push(current.role_key);
            continue;
        }
        if (
            current.value_type !== null &&
            match.valueType !== current.value_type
        ) {
            warnings.push(
                `${current.role_key}: value type ${current.value_type} → ${match.valueType}`
            );
        }
        roleMatches.push({
            roleKey: current.role_key,
            fromComponentKey: current.source_component_key,
            toComponentKey: match.componentKey,
            componentType: match.componentType,
            valueType: match.valueType
        });
    }

    const roleExtra = [
        ...new Set(
            candidate.members
                .filter((m) => !claimedCandidates.has(m.componentKey))
                .map((m) => m.roleKey)
        )
    ];

    const score = computeReplacementScore(
        roleMatches.length,
        roleMissing.length,
        currentBindings.length
    );
    return {
        compatible: roleMissing.length === 0,
        score,
        roleMatches,
        roleMissing,
        roleExtra,
        warnings
    };
}

// Returns the candidate if it isn't already claimed, then marks it claimed.
function pickUnclaimed<T extends {componentKey: string}>(
    candidate: T | undefined,
    claimed: Set<string>
): T | undefined {
    if (!candidate || claimed.has(candidate.componentKey)) return undefined;
    claimed.add(candidate.componentKey);
    return candidate;
}

function computeReplacementScore(
    matched: number,
    missing: number,
    total: number
): number {
    if (total === 0) return 0;
    const base = matched / total;
    const penalty = (missing / total) * 0.5;
    return Math.max(0, Math.min(1, base - penalty));
}

interface CurrentRoleBindingRow {
    role_key: string;
    source_component_key: string;
    value_type: 'boolean' | 'number' | 'string' | 'event' | 'json' | null;
}

async function loadCurrentRoleBindings(
    organizationId: string,
    externalId: string,
    deps: Pick<ExtractionRepositoryDeps, 'queryRows'>
): Promise<CurrentRoleBindingRow[]> {
    return queryRows<CurrentRoleBindingRow>(
        deps,
        `SELECT b.role_key, b.source_component_key, b.value_type
           FROM device.virtual_device vd
           JOIN device.list dl
             ON dl.id = vd.device_list_id
            AND dl.organization_id = vd.organization_id
           JOIN device.virtual_device_binding b
             ON b.virtual_device_list_id = vd.device_list_id
            AND b.organization_id = vd.organization_id
            AND b.effective_to IS NULL
          WHERE vd.organization_id = $1
            AND dl.external_id = $2
            AND vd.deleted_at IS NULL
            AND vd.kind = 'extracted'
          ORDER BY b.role_key`,
        [organizationId, externalId]
    );
}

export async function createExtractedDevice(
    organizationId: string,
    input: VirtualDeviceExtractionCreateParams,
    actorId: string | null,
    deps: ExtractionRepositoryDeps = defaultDeps
): Promise<VirtualDeviceDto> {
    await assertAssetBelongsToOrg(organizationId, input.imageAssetId);
    return retryExternalIdCollisions(() =>
        deps.withTransaction(async (tx) => {
            const host = await requireHostDevice(
                tx,
                organizationId,
                input.hostExternalId
            );
            const source = buildExtractionSource(host, input.sourceKey);
            const existing = await findExistingExtraction(
                tx,
                organizationId,
                host.external_id,
                input.sourceKey
            );
            if (existing) {
                throw RpcError.Domain('ResourceConflict', {
                    message: 'source is already extracted',
                    details: {
                        hostExternalId: host.external_id,
                        sourceKey: input.sourceKey,
                        externalId: existing.external_id
                    }
                });
            }

            const externalId = deps.makeExternalId();
            const deviceListId = await insertDeviceListRow(
                tx,
                externalId,
                organizationId
            );
            const capturedAt = new Date().toISOString();
            await insertVirtualDeviceRow(tx, {
                deviceListId,
                organizationId,
                input,
                source: source.preview,
                members: source.members,
                capturedAt
            });
            await replaceVirtualDeviceMemberships(tx, {
                organizationId,
                externalId,
                locationId: input.locationId,
                groupIds: input.groupIds,
                tagIds: input.tagIds
            });
            await insertInitialBindings(tx, {
                organizationId,
                deviceListId,
                host,
                source: source.preview,
                members: source.members,
                actorId,
                makeId: deps.makeId
            });
            return getVirtualDeviceByListId(tx, deviceListId);
        })
    );
}

export async function listExtractedSourceKeysByHost(
    organizationId: string | undefined,
    hostExternalIds: readonly string[],
    deps: Pick<ExtractionRepositoryDeps, 'queryRows'> = defaultDeps
): Promise<Map<string, Set<string>>> {
    if (!organizationId || hostExternalIds.length === 0) return new Map();
    const rows = await deps.queryRows<{
        host_external_id: string;
        source_component_key: string;
        hidden_keys: string[] | null;
    }>(
        `SELECT
            host.external_id AS host_external_id,
            b.source_component_key,
            ARRAY(
                SELECT jsonb_array_elements_text(
                    COALESCE(
                        vd.metadata->'extraction'->'hiddenSourceComponentKeys',
                        '[]'::jsonb
                    )
                )
            ) AS hidden_keys
           FROM device.virtual_device vd
           JOIN device.virtual_device_binding b
             ON b.virtual_device_list_id = vd.device_list_id
            AND b.organization_id = vd.organization_id
            AND b.effective_to IS NULL
           JOIN device.list host
             ON host.id = b.source_device_list_id
            AND host.organization_id = vd.organization_id
          WHERE vd.organization_id = $1
            AND vd.kind = 'extracted'
            AND vd.deleted_at IS NULL
            AND host.external_id = ANY($2::varchar[])`,
        [organizationId, [...new Set(hostExternalIds)]]
    );
    const byHost = new Map<string, Set<string>>();
    for (const row of rows) {
        const keys = byHost.get(row.host_external_id) ?? new Set<string>();
        keys.add(row.source_component_key);
        for (const key of row.hidden_keys ?? []) keys.add(key);
        byHost.set(row.host_external_id, keys);
    }
    return byHost;
}

async function requireHostDevice(
    deps: Pick<ExtractionRepositoryDeps, 'queryRows'> | QueryClient,
    organizationId: string,
    hostExternalId: string
): Promise<HostDeviceRow> {
    const rows = await queryRows<HostDeviceRow>(
        deps,
        `SELECT id, external_id, jdoc
           FROM device.list
          WHERE organization_id = $1
            AND external_id = $2
            AND COALESCE(kind, 'physical') = 'physical'
          LIMIT 1`,
        [organizationId, hostExternalId]
    );
    const host = rows[0];
    if (!host) throw RpcError.NotFound('device', hostExternalId);
    return host;
}

function buildExtractionSource(
    host: HostDeviceRow,
    sourceKey: string
): ExtractionSource {
    const jdoc = host.jdoc ?? {};
    const settings = recordAt(jdoc, 'settings');
    const status = recordAt(jdoc, 'status');
    if (sourceKey.startsWith('group:')) {
        return buildGroupExtraction(host, sourceKey, settings, status);
    }
    if (sourceKey.startsWith('service:')) {
        return buildServiceExtraction(host, sourceKey, settings, jdoc);
    }
    throw RpcError.InvalidParams('sourceKey must be group:N or service:N');
}

function buildGroupExtraction(
    host: HostDeviceRow,
    sourceKey: string,
    settings: Record<string, unknown>,
    status: Record<string, unknown>
): ExtractionSource {
    const config = recordValue(settings[sourceKey]);
    if (!config) throw RpcError.NotFound('dynamic_group', sourceKey);
    const members = groupMembers(status[sourceKey]);
    if (members.length === 0) {
        throw RpcError.InvalidParams('group source has no members', [
            {field: 'sourceKey', error: 'empty group', code: 'empty_group'}
        ]);
    }
    const classified = members.map((componentKey) =>
        classifyMember(componentKey, settings[componentKey])
    );
    const roles = classified.map((c) => c.role);
    return {
        preview: {
            hostDeviceListId: host.id,
            hostExternalId: host.external_id,
            sourceKey,
            sourceType: 'virtual_group',
            name: stringValue(config.name) ?? 'Extracted Device',
            typeKey: typeKeyFromSource(config.name, 'extracted_device'),
            categoryKey: 'dynamic_component',
            roles,
            bindings: roles.map((role) => ({
                deviceExternalId: host.external_id,
                componentKey: role.componentKey,
                dynamicCategory: role.dynamicCategory
            })),
            hiddenSourceComponentKeys: unique([sourceKey, ...members])
        },
        members: classified.map((c) => c.snapshot)
    };
}

function buildServiceExtraction(
    host: HostDeviceRow,
    sourceKey: string,
    settings: Record<string, unknown>,
    jdoc: Record<string, unknown>
): ExtractionSource {
    const classified = serviceRoles(sourceKey, settings);
    if (classified.length === 0) {
        throw RpcError.NotFound('service_resources', sourceKey);
    }
    const roles = classified.map((c) => c.role);
    const info = recordAt(jdoc, 'info');
    const serviceType = serviceTypeFromInfo(info, sourceKey);
    const productName = stringValue(recordAt(info, 'jwt').n);
    const name = productName ?? stringValue(info.name) ?? 'Service Device';
    return {
        preview: {
            hostDeviceListId: host.id,
            hostExternalId: host.external_id,
            sourceKey,
            sourceType: 'service',
            name,
            typeKey: typeKeyFromSource(serviceType, 'service_device'),
            categoryKey: 'service',
            roles,
            bindings: roles.map((role) => ({
                deviceExternalId: host.external_id,
                componentKey: role.componentKey,
                dynamicCategory: role.dynamicCategory
            })),
            hiddenSourceComponentKeys: unique([
                sourceKey,
                ...roles.map((role) => role.componentKey)
            ])
        },
        members: classified.map((c) => c.snapshot)
    };
}

function serviceRoles(
    sourceKey: string,
    settings: Record<string, unknown>
): RoleWithSnapshot[] {
    const roles: RoleWithSnapshot[] = [];
    for (const [componentKey, rawConfig] of Object.entries(settings)) {
        const config = recordValue(rawConfig);
        if (!isVirtualComponentKey(componentKey)) continue;
        if (!config) continue;
        if (recordAt(config, '_attrs').owner !== sourceKey) continue;
        const role = stringValue(recordAt(config, '_attrs').role);
        if (!role) continue;
        roles.push(classifyMember(componentKey, config, role));
    }
    return roles.sort((a, b) => a.role.roleKey.localeCompare(b.role.roleKey));
}

interface RoleWithSnapshot {
    role: VirtualDeviceExtractionRoleDto;
    snapshot: ExtractionMemberSnapshot;
}

function classifyMember(
    componentKey: string,
    rawConfig: unknown,
    preferredRole?: string,
    hostJdoc?: Record<string, unknown>
): RoleWithSnapshot {
    const config = recordValue(rawConfig) ?? {};
    const jdoc: Record<string, unknown> = hostJdoc ?? {
        settings: {[componentKey]: config}
    };
    const classification = classifySourceComponent({
        deviceExternalId: '',
        jdoc,
        componentKey
    });
    const roleKey = roleKeyFromSource(
        preferredRole ?? componentKey.replace(':', '_')
    );
    const label =
        classification.label ??
        stringValue(config.name) ??
        labelFromRole(roleKey);
    const role: VirtualDeviceExtractionRoleDto = {
        roleKey,
        label,
        componentKey,
        componentType: classification.componentType,
        writable: classification.writable,
        valueType: classification.roleValueType,
        dynamicCategory: extractionDynamicCategory(classification.sourceFamily)
    };
    const snapshot: ExtractionMemberSnapshot = {
        roleKey,
        componentKey,
        componentType: classification.componentType,
        valueType: classification.roleValueType,
        writable: classification.writable,
        required: true,
        unit: classification.unit ?? null,
        label
    };
    return {role, snapshot};
}

// Extracted devices only host dynamic (Virtual + BTHome) components, so the
// DTO never carries `null` — anything not BTHome falls back to Virtual,
// preserving prior behavior.
function extractionDynamicCategory(
    family: ReturnType<typeof classifySourceComponent>['sourceFamily']
): VirtualDeviceExtractionRoleDto['dynamicCategory'] {
    if (family === 'BTHome' || family === 'LNM') return family;
    return 'Virtual';
}

async function findExistingExtraction(
    deps: Pick<ExtractionRepositoryDeps, 'queryRows'> | QueryClient,
    organizationId: string,
    hostExternalId: string,
    sourceKey: string
): Promise<ExistingExtractionRow | null> {
    const rows = await queryRows<ExistingExtractionRow>(
        deps,
        `SELECT dl.external_id
           FROM device.virtual_device vd
           JOIN device.list dl
             ON dl.id = vd.device_list_id
            AND dl.organization_id = vd.organization_id
          WHERE vd.organization_id = $1
            AND vd.kind = 'extracted'
            AND vd.deleted_at IS NULL
            AND vd.metadata->'extraction'->>'sourceHostExternalId' = $2
            AND vd.metadata->'extraction'->>'sourceKey' = $3
          LIMIT 1`,
        [organizationId, hostExternalId, sourceKey]
    );
    return rows[0] ?? null;
}

function addExistingExtraction(
    preview: ExtractionSource['preview'],
    members: readonly ExtractionMemberSnapshot[],
    existing: ExistingExtractionRow | null
): VirtualDeviceExtractionPreviewDto {
    return {
        ...preview,
        alreadyExtracted: existing !== null,
        extractedExternalId: existing?.external_id ?? null,
        sourceSnapshot: {
            hostExternalId: preview.hostExternalId,
            hostDeviceListId: preview.hostDeviceListId,
            sourceKey: preview.sourceKey,
            sourceType: preview.sourceType,
            members: [...members],
            capturedAt: new Date().toISOString()
        }
    };
}

async function insertDeviceListRow(
    tx: QueryClient,
    externalId: string,
    organizationId: string
): Promise<number> {
    const rows = await tx.query<{id: number}>(
        `INSERT INTO device.list (
            external_id,
            control_access,
            jdoc,
            organization_id,
            kind
        )
        VALUES ($1, 3, '{}'::jsonb, $2, 'extracted')
        RETURNING id`,
        [externalId, organizationId]
    );
    const id = rows[0]?.id;
    if (!id) throw RpcError.OperationFailed('extraction create');
    return id;
}

async function insertVirtualDeviceRow(
    tx: QueryClient,
    params: {
        deviceListId: number;
        organizationId: string;
        input: VirtualDeviceExtractionCreateParams;
        source: ExtractionSource['preview'];
        members: readonly ExtractionMemberSnapshot[];
        capturedAt: string;
    }
): Promise<void> {
    await tx.query(
        `INSERT INTO device.virtual_device (
            device_list_id,
            organization_id,
            kind,
            name,
            type_key,
            category_key,
            profile_id,
            image_asset_id,
            visual_json,
            metadata
        )
        VALUES ($1, $2, 'extracted', $3, $4, $5, $6, $7, $8, $9)`,
        [
            params.deviceListId,
            params.organizationId,
            (params.input.name ?? params.source.name).trim(),
            params.input.typeKey ?? params.source.typeKey,
            params.input.categoryKey ?? params.source.categoryKey,
            params.input.profileId ?? null,
            params.input.imageAssetId ?? null,
            params.input.visual ?? {},
            buildExtractionMetadata(
                params.source,
                params.input.metadata,
                params.members,
                params.capturedAt
            )
        ]
    );
}

function buildExtractionMetadata(
    source: ExtractionSource['preview'],
    inputMetadata: Record<string, unknown> | undefined,
    members: readonly ExtractionMemberSnapshot[],
    capturedAt: string
): Record<string, unknown> {
    return {
        ...(inputMetadata ?? {}),
        extraction: {
            sourceHostExternalId: source.hostExternalId,
            sourceKey: source.sourceKey,
            sourceType: source.sourceType,
            hiddenSourceComponentKeys: source.hiddenSourceComponentKeys,
            sourceSnapshot: {
                hostExternalId: source.hostExternalId,
                hostDeviceListId: source.hostDeviceListId,
                sourceKey: source.sourceKey,
                sourceType: source.sourceType,
                members: [...members],
                capturedAt
            }
        }
    };
}

async function insertInitialBindings(
    tx: QueryClient,
    params: {
        organizationId: string;
        deviceListId: number;
        host: HostDeviceRow;
        source: ExtractionSource['preview'];
        members: readonly ExtractionMemberSnapshot[];
        actorId: string | null;
        makeId: () => string;
    }
): Promise<void> {
    const memberByRole = new Map(
        params.members.map((member) => [member.roleKey, member])
    );
    for (const role of params.source.roles) {
        const member = memberByRole.get(role.roleKey);
        if (!member) {
            throw new Error(
                `extraction member snapshot missing for role ${role.roleKey}`
            );
        }
        const bindingId = params.makeId();
        await insertInitialBinding(tx, {
            ...params,
            bindingId,
            role,
            member
        });
        await writeInitialBindingEvent(tx, {
            ...params,
            bindingId,
            eventId: params.makeId(),
            role
        });
    }
}

async function insertInitialBinding(
    tx: QueryClient,
    params: {
        organizationId: string;
        deviceListId: number;
        host: HostDeviceRow;
        bindingId: string;
        role: VirtualDeviceExtractionRoleDto;
        member: ExtractionMemberSnapshot;
        actorId: string | null;
    }
): Promise<void> {
    await tx.query(
        `INSERT INTO device.virtual_device_binding (
            id,
            organization_id,
            virtual_device_list_id,
            role_key,
            source_device_list_id,
            source_component_key,
            source_dynamic_category,
            mode,
            created_by,
            value_type,
            writable,
            required,
            unit,
            source_snapshot_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'linked', $8, $9, $10, $11, $12, $13)`,
        [
            params.bindingId,
            params.organizationId,
            params.deviceListId,
            params.role.roleKey,
            params.host.id,
            params.role.componentKey,
            params.role.dynamicCategory,
            params.actorId,
            params.member.valueType,
            params.member.writable,
            params.member.required,
            params.member.unit,
            params.member
        ]
    );
}

async function writeInitialBindingEvent(
    tx: QueryClient,
    params: {
        deviceListId: number;
        host: HostDeviceRow;
        bindingId: string;
        eventId: string;
        role: VirtualDeviceExtractionRoleDto;
        actorId: string | null;
    }
): Promise<void> {
    await tx.query(
        `INSERT INTO device.virtual_device_binding_event (
            id,
            binding_id,
            virtual_device_list_id,
            event_type,
            new_source_json,
            actor_id,
            reason
        )
        VALUES ($1, $2, $3, 'create', $4, $5, 'extraction create')`,
        [
            params.eventId,
            params.bindingId,
            params.deviceListId,
            {
                deviceExternalId: params.host.external_id,
                componentKey: params.role.componentKey,
                dynamicCategory: params.role.dynamicCategory
            },
            params.actorId
        ]
    );
}

function groupMembers(rawStatus: unknown): string[] {
    const value = recordValue(rawStatus)?.value;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => isComponentKey(item));
}

function isVirtualComponentKey(componentKey: string): boolean {
    const type = componentKey.split(':')[0] ?? '';
    return isComponentKey(componentKey) && VIRTUAL_COMPONENT_TYPES.has(type);
}

function isComponentKey(value: unknown): value is string {
    return typeof value === 'string' && /^[a-z][a-z0-9_]*:\d+$/.test(value);
}

function serviceTypeFromInfo(
    info: Record<string, unknown>,
    sourceKey: string
): string | null {
    const index = sourceKey.split(':')[1] ?? '0';
    const jwt = recordAt(info, 'jwt');
    const xt1 = recordAt(jwt, 'xt1');
    const claim = recordValue(xt1[`svc${index}`]);
    return stringValue(claim?.type);
}

function roleKeyFromSource(value: string): string {
    const key = value
        .replace(/:\d+$/, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .toLowerCase()
        .replace(/^_+|_+$/g, '');
    return /^[a-z]/.test(key) ? key : `role_${key || 'component'}`;
}

function typeKeyFromSource(value: unknown, fallback: string): string {
    const key = roleKeyFromSource(String(value ?? fallback));
    return key.length > 80 ? key.slice(0, 80).replace(/_+$/g, '') : key;
}

function labelFromRole(roleKey: string): string {
    return roleKey
        .split('_')
        .filter(Boolean)
        .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
        .join(' ');
}

function recordAt(
    source: Record<string, unknown>,
    key: string
): Record<string, unknown> {
    return recordValue(source[key]) ?? {};
}

function queryRows<T>(
    deps: Pick<ExtractionRepositoryDeps, 'queryRows'> | QueryClient,
    sql: string,
    params: readonly unknown[]
): Promise<T[]> {
    if ('queryRows' in deps) return deps.queryRows<T>(sql, params);
    return deps.query<T>(sql, params);
}

function recordValue(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function unique(values: string[]): string[] {
    return [...new Set(values)];
}

async function retryExternalIdCollisions<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < CREATE_COLLISION_RETRIES; i++) {
        try {
            return await fn();
        } catch (err) {
            if (!isExternalIdConflict(err)) throw err;
            lastErr = err;
        }
    }
    throw RpcError.OperationFailed('extraction create', lastErr);
}

function isExternalIdConflict(err: unknown): boolean {
    return (
        !!err &&
        typeof err === 'object' &&
        (err as {code?: string}).code === '23505'
    );
}

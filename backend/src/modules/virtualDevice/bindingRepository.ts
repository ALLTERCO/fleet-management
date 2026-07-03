import {createHash, randomUUID} from 'node:crypto';
import {buildListResponse, type ListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import type {
    VirtualDeviceBindingCreateParams,
    VirtualDeviceBindingDraftItem,
    VirtualDeviceBindingDto,
    VirtualDeviceBindingListParams,
    VirtualDeviceBindingListSourcesParams,
    VirtualDeviceBindingReplaceParams,
    VirtualDeviceBindingRetireParams,
    VirtualDeviceBindingSourceCandidateDto,
    VirtualDeviceBindingSourceRef,
    VirtualDeviceBindingValidateDraftParams,
    VirtualDeviceDraftPreviewDto,
    VirtualDeviceDraftPreviewParams,
    VirtualDeviceDto,
    VirtualDeviceHistoryMode,
    VirtualDeviceProfileRole,
    VirtualDeviceRoleValueType
} from '../../types/api/virtualdevice';
import * as postgres from '../PostgresProvider';
import {recordAt, recordValue, stringValue} from './recordHelpers';
import type {QueryClient} from './repository';
import {
    classifySourceComponent,
    collectBindableComponentKeys
} from './sourceClassifier';

interface BindingRepositoryDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
    withTransaction<T>(fn: (client: QueryClient) => Promise<T>): Promise<T>;
    makeId(): string;
}

interface VirtualDeviceBindingRow {
    id: string;
    role_key: string;
    source_external_id: string;
    source_component_key: string;
    source_dynamic_category: string | null;
    mode: VirtualDeviceProfileRole['historyMode'];
    visual_json: Record<string, unknown> | null;
    effective_from: Date | string | null;
    effective_to: Date | string | null;
    created_at: Date | string;
}

interface IdempotentBindingEventRow extends VirtualDeviceBindingRow {
    request_hash: string | null;
}

interface VirtualDeviceLockRow {
    device_list_id: number;
    revision: number | string;
    profile_roles: VirtualDeviceProfileRole[] | null;
}

export interface InitialVirtualDeviceBindingsInput {
    organizationId: string;
    externalId: string;
    deviceListId: number;
    profileRoles: VirtualDeviceProfileRole[] | null;
    bindings: readonly VirtualDeviceBindingDraftItem[];
    actorId: string | null;
    makeId: () => string;
}

interface SourceDeviceRow {
    id: number;
    external_id: string;
    jdoc?: Record<string, unknown> | null;
}

interface SourceCandidateDeviceRow {
    id: number;
    external_id: string;
    kind?: string | null;
    jdoc: Record<string, unknown> | null;
}

const defaultDeps: BindingRepositoryDeps = {
    queryRows: postgres.queryRows,
    withTransaction: postgres.withQueryTransaction,
    makeId: randomUUID
};

export async function listVirtualDeviceBindings(
    organizationId: string,
    input: VirtualDeviceBindingListParams,
    deps: BindingRepositoryDeps = defaultDeps
): Promise<{items: VirtualDeviceBindingDto[]}> {
    const device = await getVirtualDeviceForBinding(
        organizationId,
        input.externalId,
        deps
    );
    const rows = await deps.queryRows<VirtualDeviceBindingRow>(
        `${bindingSelect()}
          WHERE b.organization_id = $1
            AND b.virtual_device_list_id = $2
          ORDER BY
            CASE WHEN b.effective_to IS NULL THEN 0 ELSE 1 END,
            b.role_key ASC,
            b.effective_from DESC`,
        [organizationId, device.device_list_id]
    );
    return {items: rows.map(rowToBinding)};
}

export async function listVirtualDeviceBindingSources(
    organizationId: string,
    input: VirtualDeviceBindingListSourcesParams,
    deps: Pick<BindingRepositoryDeps, 'queryRows'> = defaultDeps
): Promise<ListResponse<VirtualDeviceBindingSourceCandidateDto>> {
    const rows = await listSourceDeviceRows(organizationId, input, deps);
    const candidates = sourceCandidatesFromRows(rows, input);
    const limit = input.limit ?? 200;
    const offset = input.offset ?? 0;
    return buildListResponse(
        sliceCandidates(candidates, limit, offset),
        candidates.length,
        limit,
        offset
    );
}

export async function validateVirtualDeviceBindingDraft(
    organizationId: string,
    input: VirtualDeviceBindingValidateDraftParams,
    deps: Pick<BindingRepositoryDeps, 'queryRows'> = defaultDeps
): Promise<{valid: boolean; errors: DraftValidationError[]}> {
    const device = await getVirtualDeviceForDraft(
        organizationId,
        input.externalId,
        deps
    );
    const errors = validateDraftShape(input.bindings, device.profile_roles);
    if (errors.length > 0) return {valid: false, errors};
    const sourceErrors = await validateDraftSources(
        organizationId,
        input.bindings,
        device.device_list_id,
        deps
    );
    return {valid: sourceErrors.length === 0, errors: sourceErrors};
}

export async function previewVirtualDeviceDraft(
    organizationId: string,
    input: VirtualDeviceDraftPreviewParams,
    deps: Pick<BindingRepositoryDeps, 'queryRows'> = defaultDeps
): Promise<VirtualDeviceDraftPreviewDto> {
    const draftExternalId = 'vdev_preview';
    const validation = await validateNewVirtualDeviceDraft(
        organizationId,
        input.bindings,
        deps
    );
    return {
        device: draftDevice(input.device, organizationId, draftExternalId),
        bindings: draftBindings(input.bindings, input.device),
        validation
    };
}

export async function createVirtualDeviceBinding(
    organizationId: string,
    input: VirtualDeviceBindingCreateParams,
    actorId: string | null,
    deps: BindingRepositoryDeps = defaultDeps
): Promise<VirtualDeviceBindingDto> {
    return deps.withTransaction(async (tx) => {
        const device = await lockVirtualDevice(
            tx,
            organizationId,
            input.externalId
        );
        assertRevision(device, input.expectedRevision, input.externalId);
        const mode = bindingModeForRole(device, input.roleKey);
        const source = await resolveSourceDevice(tx, organizationId, input);
        assertNotSelfBinding(device, source, input.source);
        assertSourceComponentExists(source, input.source);
        const oldBinding = await getActiveBinding(
            tx,
            organizationId,
            device.device_list_id,
            input.roleKey
        );
        assertNoActiveBinding(oldBinding, input.roleKey);
        const inserted = await insertBinding(tx, {
            id: deps.makeId(),
            organizationId,
            deviceListId: device.device_list_id,
            roleKey: input.roleKey,
            mode,
            source,
            input,
            semantics: resolveBindingSemantics(source, input, device)
        });
        await writeBindingEvent(tx, {
            id: deps.makeId(),
            bindingId: inserted.id,
            deviceListId: device.device_list_id,
            eventType: 'create',
            oldSource: null,
            newSource: bindingSource(inserted),
            actorId,
            reason: input.reason
        });
        await bumpVirtualDeviceRevision(
            tx,
            organizationId,
            device.device_list_id
        );
        return rowToBinding(inserted);
    });
}

export async function createInitialVirtualDeviceBindings(
    tx: QueryClient,
    input: InitialVirtualDeviceBindingsInput
): Promise<void> {
    const shapeErrors = validateDraftShape(input.bindings, input.profileRoles);
    if (shapeErrors.length > 0) {
        throw RpcError.InvalidParams('invalid initial bindings', shapeErrors);
    }
    const device: VirtualDeviceLockRow = {
        device_list_id: input.deviceListId,
        revision: 1,
        profile_roles: input.profileRoles
    };
    for (const binding of input.bindings) {
        await createInitialBinding(tx, input, device, binding);
        await bumpVirtualDeviceRevision(
            tx,
            input.organizationId,
            input.deviceListId
        );
    }
}

async function createInitialBinding(
    tx: QueryClient,
    input: InitialVirtualDeviceBindingsInput,
    device: VirtualDeviceLockRow,
    binding: VirtualDeviceBindingDraftItem
): Promise<void> {
    const source = await resolveSourceDevice(tx, input.organizationId, {
        externalId: input.externalId,
        roleKey: binding.roleKey,
        source: binding.source,
        expectedRevision: 1
    });
    assertNotSelfBinding(device, source, binding.source);
    assertSourceComponentExists(source, binding.source);
    const bindingInput = {
        externalId: input.externalId,
        roleKey: binding.roleKey,
        source: binding.source,
        expectedRevision: 1,
        visual: binding.visual
    };
    const inserted = await insertBinding(tx, {
        id: input.makeId(),
        organizationId: input.organizationId,
        deviceListId: input.deviceListId,
        roleKey: binding.roleKey,
        mode: bindingModeForRole(device, binding.roleKey),
        source,
        input: bindingInput,
        semantics: resolveBindingSemantics(source, bindingInput, device)
    });
    await writeBindingEvent(tx, {
        id: input.makeId(),
        bindingId: inserted.id,
        deviceListId: input.deviceListId,
        eventType: 'create',
        oldSource: null,
        newSource: bindingSource(inserted),
        actorId: input.actorId,
        reason: 'VirtualDevice.Create'
    });
}

export async function replaceVirtualDeviceBinding(
    organizationId: string,
    input: VirtualDeviceBindingReplaceParams,
    actorId: string | null,
    deps: BindingRepositoryDeps = defaultDeps
): Promise<VirtualDeviceBindingDto> {
    return deps.withTransaction(async (tx) => {
        const device = await lockVirtualDevice(
            tx,
            organizationId,
            input.externalId
        );
        const replay = await getIdempotentBindingResult(tx, {
            deviceListId: device.device_list_id,
            idempotencyKey: input.idempotencyKey,
            requestHash: bindingReplaceRequestHash(input)
        });
        if (replay) return rowToBinding(replay);
        assertRevision(device, input.expectedRevision, input.externalId);
        const mode = bindingModeForRole(device, input.roleKey);
        const source = await resolveSourceDevice(tx, organizationId, input);
        assertNotSelfBinding(device, source, input.source);
        assertSourceComponentExists(source, input.source);
        const oldBinding = await getActiveBinding(
            tx,
            organizationId,
            device.device_list_id,
            input.roleKey
        );
        await retireActiveBinding(tx, {
            organizationId,
            deviceListId: device.device_list_id,
            roleKey: input.roleKey,
            effectiveTo: input.effectiveFrom,
            actorId,
            reason: input.reason
        });
        const inserted = await insertBinding(tx, {
            id: deps.makeId(),
            organizationId,
            deviceListId: device.device_list_id,
            roleKey: input.roleKey,
            mode,
            source,
            input,
            semantics: resolveBindingSemantics(source, input, device)
        });
        await writeBindingEvent(tx, {
            id: deps.makeId(),
            bindingId: inserted.id,
            deviceListId: device.device_list_id,
            eventType: oldBinding ? 'replace' : 'create',
            oldSource: oldBinding ? bindingSource(oldBinding) : null,
            newSource: bindingSource(inserted),
            actorId,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
            requestHash: bindingReplaceRequestHash(input)
        });
        await bumpVirtualDeviceRevision(
            tx,
            organizationId,
            device.device_list_id
        );
        return rowToBinding(inserted);
    });
}

interface DraftValidationError {
    field: string;
    error: string;
    code: string;
}

async function listSourceDeviceRows(
    organizationId: string,
    input: VirtualDeviceBindingListSourcesParams,
    deps: Pick<BindingRepositoryDeps, 'queryRows'>
): Promise<SourceCandidateDeviceRow[]> {
    const values: unknown[] = [organizationId];
    // Virtual-to-virtual binding is disallowed in this release — cycle
    // detection, lineage dedup and command-loop prevention land in a later
    // phase. Only rows without a virtual_device record (physical, bluetooth,
    // connector) qualify as sources.
    const where = ['dl.organization_id = $1', 'vd.device_list_id IS NULL'];
    if (input.externalId) {
        values.push(input.externalId);
        where.push(`dl.external_id <> $${values.length}`);
    }
    if (input.query) {
        values.push(`%${input.query}%`);
        where.push(
            `(dl.external_id ILIKE $${values.length} OR dl.jdoc->'info'->>'name' ILIKE $${values.length} OR dl.kind = 'connector')`
        );
    }
    return deps.queryRows<SourceCandidateDeviceRow>(
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

function sourceCandidatesFromRows(
    rows: readonly SourceCandidateDeviceRow[],
    input: VirtualDeviceBindingListSourcesParams
): VirtualDeviceBindingSourceCandidateDto[] {
    return rows
        .flatMap((row) => sourceCandidatesFromRow(row))
        .filter((candidate) => sourceCandidateMatches(candidate, input));
}

function sourceCandidatesFromRow(
    row: SourceCandidateDeviceRow
): VirtualDeviceBindingSourceCandidateDto[] {
    const jdoc = row.jdoc ?? {};
    const componentKeys = collectBindableComponentKeys({jdoc});
    return componentKeys.map((componentKey) =>
        sourceCandidateFromComponent(row, componentKey)
    );
}

function sourceCandidateFromComponent(
    row: SourceCandidateDeviceRow,
    componentKey: string
): VirtualDeviceBindingSourceCandidateDto {
    const classification = classifySourceComponent({
        deviceExternalId: row.external_id,
        deviceKind: row.kind ?? null,
        jdoc: row.jdoc ?? {},
        componentKey
    });
    const connector = recordValue(classification.sourceHints.connector);
    return {
        deviceExternalId: row.external_id,
        deviceName: deviceName(row),
        componentKey,
        componentType: classification.componentType,
        dynamicCategory: dtoDynamicCategory(classification.sourceFamily),
        label: classification.label,
        valueType: classification.roleValueType,
        writable: classification.writable,
        ...(connector
            ? {
                  connector: {
                      protocol: String(connector.protocol ?? ''),
                      pointId:
                          connector.pointId == null
                              ? null
                              : String(connector.pointId)
                  }
              }
            : {})
    };
}

function dtoDynamicCategory(
    family: ReturnType<typeof classifySourceComponent>['sourceFamily']
): VirtualDeviceBindingSourceCandidateDto['dynamicCategory'] {
    if (family === 'Virtual' || family === 'BTHome' || family === 'LNM') {
        return family;
    }
    return null;
}

function sourceCandidateMatches(
    candidate: VirtualDeviceBindingSourceCandidateDto,
    input: VirtualDeviceBindingListSourcesParams
): boolean {
    if (
        input.componentType &&
        candidate.componentType !== input.componentType
    ) {
        return false;
    }
    if (input.query && !sourceCandidateIncludes(candidate, input.query)) {
        return false;
    }
    return true;
}

function sourceCandidateIncludes(
    candidate: VirtualDeviceBindingSourceCandidateDto,
    query: string
): boolean {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [
        candidate.deviceExternalId,
        candidate.deviceName,
        candidate.componentKey,
        candidate.componentType,
        candidate.label,
        candidate.connector?.protocol,
        candidate.connector?.pointId
    ].some((value) => value?.toLowerCase().includes(needle));
}

function sliceCandidates<T>(
    candidates: readonly T[],
    limit: number,
    offset: number
): T[] {
    if (limit === 0) return candidates.slice(offset);
    return candidates.slice(offset, offset + limit);
}

async function getVirtualDeviceForDraft(
    organizationId: string,
    externalId: string,
    deps: Pick<BindingRepositoryDeps, 'queryRows'>
): Promise<VirtualDeviceLockRow> {
    const rows = await deps.queryRows<VirtualDeviceLockRow>(
        `SELECT
            vd.device_list_id,
            vd.revision,
            vdp.roles_json AS profile_roles
           FROM device.virtual_device vd
           JOIN device.list dl
             ON dl.id = vd.device_list_id
            AND dl.organization_id = vd.organization_id
      LEFT JOIN device.virtual_device_profile vdp
             ON vdp.id = vd.profile_id
            AND vdp.organization_id = vd.organization_id
            AND vdp.deleted_at IS NULL
          WHERE vd.organization_id = $1
            AND dl.external_id = $2
            AND vd.deleted_at IS NULL
          LIMIT 1`,
        [organizationId, externalId]
    );
    const row = rows[0];
    if (!row) throw RpcError.NotFound('virtual_device', externalId);
    return row;
}

function validateDraftShape(
    bindings: readonly VirtualDeviceBindingDraftItem[],
    roles: readonly VirtualDeviceProfileRole[] | null
): DraftValidationError[] {
    return [
        ...validateDraftRoleUniqueness(bindings),
        ...validateDraftProfileRoles(bindings, roles)
    ];
}

function validateDraftRoleUniqueness(
    bindings: readonly VirtualDeviceBindingDraftItem[]
): DraftValidationError[] {
    const seen = new Set<string>();
    const errors: DraftValidationError[] = [];
    bindings.forEach((binding, index) => {
        if (!seen.has(binding.roleKey)) {
            seen.add(binding.roleKey);
            return;
        }
        errors.push({
            field: `bindings.${index}.roleKey`,
            error: 'roleKey must be unique',
            code: 'duplicate_role'
        });
    });
    return errors;
}

function validateDraftProfileRoles(
    bindings: readonly VirtualDeviceBindingDraftItem[],
    roles: readonly VirtualDeviceProfileRole[] | null
): DraftValidationError[] {
    if (!roles || roles.length === 0) return [];
    const roleKeys = new Set(roles.map((role) => role.roleKey));
    return bindings.flatMap((binding, index) => {
        if (roleKeys.has(binding.roleKey)) return [];
        return [
            {
                field: `bindings.${index}.roleKey`,
                error: 'roleKey is not defined by profile',
                code: 'unknown_role'
            }
        ];
    });
}

async function validateDraftSources(
    organizationId: string,
    bindings: readonly VirtualDeviceBindingDraftItem[],
    targetDeviceListId: number,
    deps: Pick<BindingRepositoryDeps, 'queryRows'>
): Promise<DraftValidationError[]> {
    const errors: DraftValidationError[] = [];
    const sources = await loadSourceDevices(
        deps,
        organizationId,
        bindings.map((b) => b.source.deviceExternalId)
    );
    for (const [index, binding] of bindings.entries()) {
        const source = sources.get(binding.source.deviceExternalId);
        if (!source) {
            errors.push(sourceError(index, 'deviceExternalId', 'not_found'));
            continue;
        }
        if (source.id === targetDeviceListId) {
            errors.push(sourceError(index, 'deviceExternalId', 'self_binding'));
            continue;
        }
        if (!sourceHasComponent(source, binding.source.componentKey)) {
            errors.push(sourceError(index, 'componentKey', 'not_found'));
        }
    }
    return errors;
}

async function validateNewVirtualDeviceDraft(
    organizationId: string,
    bindings: readonly VirtualDeviceBindingDraftItem[],
    deps: Pick<BindingRepositoryDeps, 'queryRows'>
): Promise<{valid: boolean; errors: DraftValidationError[]}> {
    const shapeErrors = validateDraftRoleUniqueness(bindings);
    if (shapeErrors.length > 0) return {valid: false, errors: shapeErrors};
    const sourceErrors: DraftValidationError[] = [];
    const sources = await loadSourceDevices(
        deps,
        organizationId,
        bindings.map((b) => b.source.deviceExternalId)
    );
    for (const [index, binding] of bindings.entries()) {
        const source = sources.get(binding.source.deviceExternalId);
        if (!source) {
            sourceErrors.push(
                sourceError(index, 'deviceExternalId', 'not_found')
            );
            continue;
        }
        if (!sourceHasComponent(source, binding.source.componentKey)) {
            sourceErrors.push(sourceError(index, 'componentKey', 'not_found'));
        }
    }
    return {valid: sourceErrors.length === 0, errors: sourceErrors};
}

function sourceError(
    index: number,
    field: 'deviceExternalId' | 'componentKey',
    code: 'not_found' | 'self_binding'
): DraftValidationError {
    return {
        field: `bindings.${index}.source.${field}`,
        error: code === 'self_binding' ? 'source cannot be self' : 'not found',
        code
    };
}

function draftDevice(
    input: VirtualDeviceDraftPreviewParams['device'],
    organizationId: string,
    externalId: string
): VirtualDeviceDto {
    return {
        deviceListId: 1,
        externalId,
        organizationId,
        kind: input.kind,
        name: input.name.trim(),
        typeKey: input.typeKey,
        categoryKey: input.categoryKey ?? null,
        profileId: input.profileId ?? null,
        imageAssetId: input.imageAssetId ?? null,
        locationId: input.locationId ?? null,
        groupIds: input.groupIds ?? [],
        tagIds: input.tagIds ?? [],
        enabled: true,
        revision: 1,
        visual: input.visual ?? {},
        metadata: input.metadata ?? {}
    };
}

function draftBindings(
    bindings: readonly VirtualDeviceBindingDraftItem[],
    device: VirtualDeviceDraftPreviewParams['device']
): VirtualDeviceBindingDto[] {
    return bindings.map((binding, index) => ({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        roleKey: binding.roleKey,
        source: binding.source,
        mode: draftBindingMode(device),
        active: true,
        effectiveFrom: null,
        effectiveTo: null,
        visual: binding.visual ?? {},
        createdAt: new Date(0).toISOString()
    }));
}

function draftBindingMode(
    device: VirtualDeviceDraftPreviewParams['device']
): VirtualDeviceHistoryMode {
    return device.kind === 'composed' ? 'linked' : 'live_only';
}

export async function retireVirtualDeviceBinding(
    organizationId: string,
    input: VirtualDeviceBindingRetireParams,
    actorId: string | null,
    deps: BindingRepositoryDeps = defaultDeps
): Promise<VirtualDeviceBindingDto> {
    return deps.withTransaction(async (tx) => {
        const device = await lockVirtualDevice(
            tx,
            organizationId,
            input.externalId
        );
        assertRevision(device, input.expectedRevision, input.externalId);
        const binding = await getBindingForDevice(
            tx,
            organizationId,
            device.device_list_id,
            input.bindingId
        );
        if (!binding)
            throw RpcError.NotFound('virtual_binding', input.bindingId);
        if (binding.effective_to !== null) return rowToBinding(binding);
        const retired = await retireBinding(tx, {
            bindingId: input.bindingId,
            effectiveTo: input.effectiveTo,
            actorId,
            reason: input.reason
        });
        await writeBindingEvent(tx, {
            id: deps.makeId(),
            bindingId: retired.id,
            deviceListId: device.device_list_id,
            eventType: 'retire',
            oldSource: bindingSource(binding),
            newSource: null,
            actorId,
            reason: input.reason
        });
        await bumpVirtualDeviceRevision(
            tx,
            organizationId,
            device.device_list_id
        );
        return rowToBinding(retired);
    });
}

async function getVirtualDeviceForBinding(
    organizationId: string,
    externalId: string,
    deps: BindingRepositoryDeps
): Promise<{device_list_id: number}> {
    const rows = await deps.queryRows<{device_list_id: number}>(
        `SELECT vd.device_list_id
           FROM device.virtual_device vd
           JOIN device.list dl
             ON dl.id = vd.device_list_id
            AND dl.organization_id = vd.organization_id
          WHERE vd.organization_id = $1
            AND dl.external_id = $2
            AND vd.deleted_at IS NULL
          LIMIT 1`,
        [organizationId, externalId]
    );
    const row = rows[0];
    if (!row) throw RpcError.NotFound('virtual_device', externalId);
    return row;
}

async function lockVirtualDevice(
    tx: QueryClient,
    organizationId: string,
    externalId: string
): Promise<VirtualDeviceLockRow> {
    const rows = await tx.query<VirtualDeviceLockRow>(
        `SELECT
            vd.device_list_id,
            vd.revision,
            vdp.roles_json AS profile_roles
           FROM device.virtual_device vd
           JOIN device.list dl
             ON dl.id = vd.device_list_id
            AND dl.organization_id = vd.organization_id
      LEFT JOIN device.virtual_device_profile vdp
             ON vdp.id = vd.profile_id
            AND vdp.organization_id = vd.organization_id
            AND vdp.deleted_at IS NULL
          WHERE vd.organization_id = $1
            AND dl.external_id = $2
            AND vd.deleted_at IS NULL
          LIMIT 1
          FOR UPDATE OF vd`,
        [organizationId, externalId]
    );
    const row = rows[0];
    if (!row) throw RpcError.NotFound('virtual_device', externalId);
    return row;
}

function assertRevision(
    device: VirtualDeviceLockRow,
    expectedRevision: number,
    externalId: string
): void {
    if (Number(device.revision) === expectedRevision) return;
    throw RpcError.Domain('ResourceConflict', {
        message: 'virtual device revision conflict',
        details: {resourceType: 'virtual_device', identifier: externalId}
    });
}

async function resolveSourceDevice(
    tx: QueryClient,
    organizationId: string,
    input: VirtualDeviceBindingReplaceParams
): Promise<SourceDeviceRow> {
    // LEFT JOIN exposes whether this row is itself a virtual device so we
    // can reject virtual-to-virtual bindings server-side, not only at the
    // picker. Virtual-to-virtual bindings are disallowed.
    const rows = await tx.query<
        SourceDeviceRow & {virtual_device_list_id: number | null}
    >(
        `SELECT dl.id, dl.external_id, dl.jdoc,
                vd.device_list_id AS virtual_device_list_id
           FROM device.list dl
      LEFT JOIN device.virtual_device vd
             ON vd.device_list_id = dl.id
            AND vd.organization_id = dl.organization_id
            AND vd.deleted_at IS NULL
          WHERE dl.organization_id = $1
            AND dl.external_id = $2
          LIMIT 1`,
        [organizationId, input.source.deviceExternalId]
    );
    const row = rows[0];
    if (!row) {
        throw RpcError.NotFound('source_device', input.source.deviceExternalId);
    }
    // Loose != null so undefined (mocked rows without the joined column) passes.
    if (row.virtual_device_list_id != null) {
        throw RpcError.InvalidParams(
            'virtual-to-virtual binding is not allowed',
            [
                {
                    field: 'source.deviceExternalId',
                    error: input.source.deviceExternalId,
                    code: 'virtual_source_disallowed'
                }
            ]
        );
    }
    return row;
}

// One query for a whole draft — per-binding lookups made validation O(n)
// round-trips for up to 100 bindings.
async function loadSourceDevices(
    deps: Pick<BindingRepositoryDeps, 'queryRows'>,
    organizationId: string,
    externalIds: readonly string[]
): Promise<Map<string, SourceDeviceRow>> {
    const distinct = [...new Set(externalIds)];
    if (distinct.length === 0) return new Map();
    const rows = await deps.queryRows<SourceDeviceRow>(
        `SELECT id, external_id, jdoc
           FROM device.list
          WHERE organization_id = $1
            AND external_id = ANY($2)`,
        [organizationId, distinct]
    );
    return new Map(rows.map((row) => [row.external_id, row]));
}

function assertNotSelfBinding(
    device: VirtualDeviceLockRow,
    source: SourceDeviceRow,
    sourceRef: VirtualDeviceBindingSourceRef
): void {
    if (device.device_list_id !== source.id) return;
    throw RpcError.InvalidParams('virtual device cannot bind to itself', [
        {
            field: 'source.deviceExternalId',
            error: 'source cannot be the virtual device itself',
            code: 'self_binding'
        },
        {
            field: 'source.componentKey',
            error: sourceRef.componentKey,
            code: 'self_binding_component'
        }
    ]);
}

function assertSourceComponentExists(
    source: SourceDeviceRow,
    sourceRef: VirtualDeviceBindingSourceRef
): void {
    if (sourceHasComponent(source, sourceRef.componentKey)) return;
    throw RpcError.NotFound('source_component', sourceRef.componentKey);
}

function sourceHasComponent(
    source: Pick<SourceDeviceRow, 'jdoc'>,
    componentKey: string
): boolean {
    const jdoc = source.jdoc ?? {};
    return collectBindableComponentKeys({jdoc}).includes(componentKey);
}

function assertNoActiveBinding(
    oldBinding: VirtualDeviceBindingRow | null,
    roleKey: string
): void {
    if (!oldBinding) return;
    throw RpcError.Domain('ResourceConflict', {
        message: 'role already has an active binding',
        details: {roleKey}
    });
}

async function getActiveBinding(
    tx: QueryClient,
    organizationId: string,
    deviceListId: number,
    roleKey: string
): Promise<VirtualDeviceBindingRow | null> {
    const rows = await tx.query<VirtualDeviceBindingRow>(
        `${bindingSelect()}
          WHERE b.organization_id = $1
            AND b.virtual_device_list_id = $2
            AND b.role_key = $3
            AND b.effective_to IS NULL
          LIMIT 1`,
        [organizationId, deviceListId, roleKey]
    );
    return rows[0] ?? null;
}

async function getIdempotentBindingResult(
    tx: QueryClient,
    input: {
        deviceListId: number;
        idempotencyKey?: string;
        requestHash: string;
    }
): Promise<IdempotentBindingEventRow | null> {
    if (!input.idempotencyKey) return null;
    const rows = await tx.query<IdempotentBindingEventRow>(
        `${idempotentBindingSelect()}
          WHERE e.virtual_device_list_id = $1
            AND e.idempotency_key = $2
          LIMIT 1`,
        [input.deviceListId, input.idempotencyKey]
    );
    const row = rows[0];
    if (!row) return null;
    assertIdempotencyHash(row, input.requestHash, input.idempotencyKey);
    return row;
}

function assertIdempotencyHash(
    row: IdempotentBindingEventRow,
    requestHash: string,
    idempotencyKey: string
): void {
    if (row.request_hash === requestHash) return;
    throw RpcError.Domain('ResourceConflict', {
        message: 'idempotency key already used with different payload',
        details: {idempotencyKey}
    });
}

async function getBindingForDevice(
    tx: QueryClient,
    organizationId: string,
    deviceListId: number,
    bindingId: string
): Promise<VirtualDeviceBindingRow | null> {
    const rows = await tx.query<VirtualDeviceBindingRow>(
        `${bindingSelect()}
          WHERE b.organization_id = $1
            AND b.virtual_device_list_id = $2
            AND b.id = $3
          LIMIT 1`,
        [organizationId, deviceListId, bindingId]
    );
    return rows[0] ?? null;
}

async function retireActiveBinding(
    tx: QueryClient,
    input: {
        organizationId: string;
        deviceListId: number;
        roleKey: string;
        effectiveTo?: string;
        actorId: string | null;
        reason?: string;
    }
): Promise<void> {
    await tx.query(
        `UPDATE device.virtual_device_binding
            SET effective_to = COALESCE($4::timestamptz, NOW()),
                retired_by = $5,
                retired_reason = $6
          WHERE organization_id = $1
            AND virtual_device_list_id = $2
            AND role_key = $3
            AND effective_to IS NULL`,
        [
            input.organizationId,
            input.deviceListId,
            input.roleKey,
            input.effectiveTo ?? null,
            input.actorId,
            input.reason ?? null
        ]
    );
}

interface BindingSemantics {
    valueType: VirtualDeviceRoleValueType;
    writable: boolean;
    required: boolean;
    unit: string | null;
    sourceSnapshot: Record<string, unknown>;
    roleMetadata: Record<string, unknown> | null;
}

function resolveBindingSemantics(
    source: SourceDeviceRow,
    input: VirtualDeviceBindingReplaceParams,
    device: VirtualDeviceLockRow
): BindingSemantics {
    const classification = classifySourceComponent({
        deviceExternalId: source.external_id,
        jdoc: source.jdoc ?? {},
        componentKey: input.source.componentKey
    });
    // Profile role wins when present; classifier is the fallback for
    // unprofiled (composed/extracted-only) bindings.
    const profileRole = device.profile_roles?.find(
        (role) => role.roleKey === input.roleKey
    );
    const valueType = profileRole?.valueType ?? classification.roleValueType;
    const writable = profileRole?.writable ?? classification.writable;
    const required = profileRole?.required ?? true;
    const unit = profileRole?.unit ?? classification.unit ?? null;
    return {
        valueType,
        writable,
        required,
        unit,
        sourceSnapshot: {
            roleKey: input.roleKey,
            componentKey: input.source.componentKey,
            componentType: classification.componentType,
            valueType,
            writable,
            required,
            unit,
            label: classification.label,
            capturedAt: new Date().toISOString()
        },
        // Profile metadata carries display hints (min/max/step/options/etc.)
        // that the card layer reads at render time via entityProjection.
        roleMetadata: profileRole?.metadata ?? null
    };
}

async function insertBinding(
    tx: QueryClient,
    input: {
        id: string;
        organizationId: string;
        deviceListId: number;
        roleKey: string;
        mode: VirtualDeviceProfileRole['historyMode'];
        source: SourceDeviceRow;
        input: VirtualDeviceBindingReplaceParams;
        semantics: BindingSemantics;
    }
): Promise<VirtualDeviceBindingRow> {
    const rows = await tx.query<VirtualDeviceBindingRow>(
        `${bindingInsertSql()}
         RETURNING
            id,
            role_key,
            $5::varchar AS source_external_id,
            source_component_key,
            source_dynamic_category,
            mode,
            visual_json,
            effective_from,
            effective_to,
            created_at`,
        [
            input.id,
            input.organizationId,
            input.deviceListId,
            input.roleKey,
            input.source.external_id,
            input.source.id,
            input.input.source.componentKey,
            input.input.source.dynamicCategory ?? null,
            input.mode,
            input.input.visual ?? {},
            input.input.effectiveFrom ?? null,
            input.semantics.valueType,
            input.semantics.writable,
            input.semantics.required,
            input.semantics.unit,
            input.semantics.sourceSnapshot,
            input.semantics.roleMetadata
        ]
    );
    return requireBindingRow(rows, input.id);
}

function bindingInsertSql(): string {
    return `INSERT INTO device.virtual_device_binding (
            id,
            organization_id,
            virtual_device_list_id,
            role_key,
            source_device_list_id,
            source_component_key,
            source_dynamic_category,
            mode,
            visual_json,
            effective_from,
            value_type,
            writable,
            required,
            unit,
            source_snapshot_json,
            role_metadata_json
        )
        VALUES (
            $1,
            $2,
            $3,
            $4,
            $6,
            $7,
            $8,
            $9,
            $10,
            COALESCE($11::timestamptz, NOW()),
            $12,
            $13,
            $14,
            $15,
            $16,
            $17
        )`;
}

async function retireBinding(
    tx: QueryClient,
    input: {
        bindingId: string;
        effectiveTo?: string;
        actorId: string | null;
        reason?: string;
    }
): Promise<VirtualDeviceBindingRow> {
    const rows = await tx.query<VirtualDeviceBindingRow>(
        `WITH retired AS (
            UPDATE device.virtual_device_binding
               SET effective_to = COALESCE($2::timestamptz, NOW()),
                   retired_by = $3,
                   retired_reason = $4
             WHERE id = $1
               AND effective_to IS NULL
             RETURNING *
         )
         SELECT
            r.id,
            r.role_key,
            dl.external_id AS source_external_id,
            r.source_component_key,
            r.source_dynamic_category,
            r.mode,
            r.visual_json,
            r.effective_from,
            r.effective_to,
            r.created_at
           FROM retired r
           JOIN device.list dl
             ON dl.id = r.source_device_list_id
            AND dl.organization_id = r.organization_id`,
        [
            input.bindingId,
            input.effectiveTo ?? null,
            input.actorId,
            input.reason ?? null
        ]
    );
    return requireBindingRow(rows, input.bindingId);
}

async function writeBindingEvent(
    tx: QueryClient,
    input: {
        id: string;
        bindingId: string;
        deviceListId: number;
        eventType: 'create' | 'replace' | 'retire';
        oldSource: VirtualDeviceBindingSourceRef | null;
        newSource: VirtualDeviceBindingSourceRef | null;
        actorId: string | null;
        reason?: string;
        idempotencyKey?: string;
        requestHash?: string;
    }
): Promise<void> {
    await tx.query(
        `INSERT INTO device.virtual_device_binding_event (
            id,
            binding_id,
            virtual_device_list_id,
            event_type,
            old_source_json,
            new_source_json,
            actor_id,
            reason,
            idempotency_key,
            request_hash
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
            input.id,
            input.bindingId,
            input.deviceListId,
            input.eventType,
            input.oldSource,
            input.newSource,
            input.actorId,
            input.reason ?? null,
            input.idempotencyKey ?? null,
            input.requestHash ?? null
        ]
    );
}

function bindingReplaceRequestHash(
    input: VirtualDeviceBindingReplaceParams
): string {
    return createHash('sha256')
        .update(
            JSON.stringify({
                externalId: input.externalId,
                roleKey: input.roleKey,
                source: input.source,
                effectiveFrom: input.effectiveFrom ?? null,
                reason: input.reason ?? null
            })
        )
        .digest('hex');
}

async function bumpVirtualDeviceRevision(
    tx: QueryClient,
    organizationId: string,
    deviceListId: number
): Promise<void> {
    await tx.query(
        `UPDATE device.virtual_device
            SET revision = revision + 1,
                updated_at = NOW()
          WHERE organization_id = $1
            AND device_list_id = $2`,
        [organizationId, deviceListId]
    );
}

function bindingSelect(): string {
    return `SELECT
            b.id,
            b.role_key,
            dl.external_id AS source_external_id,
            b.source_component_key,
            b.source_dynamic_category,
            b.mode,
            b.visual_json,
            b.effective_from,
            b.effective_to,
            b.created_at
           FROM device.virtual_device_binding b
           JOIN device.list dl
             ON dl.id = b.source_device_list_id
            AND dl.organization_id = b.organization_id`;
}

function idempotentBindingSelect(): string {
    return `SELECT
            b.id,
            b.role_key,
            dl.external_id AS source_external_id,
            b.source_component_key,
            b.source_dynamic_category,
            b.mode,
            b.visual_json,
            b.effective_from,
            b.effective_to,
            b.created_at,
            e.request_hash
           FROM device.virtual_device_binding_event e
           JOIN device.virtual_device_binding b
             ON b.id = e.binding_id
           JOIN device.list dl
             ON dl.id = b.source_device_list_id
            AND dl.organization_id = b.organization_id`;
}

function rowToBinding(row: VirtualDeviceBindingRow): VirtualDeviceBindingDto {
    return {
        id: row.id,
        roleKey: row.role_key,
        source: bindingSource(row),
        mode: row.mode,
        active: row.effective_to === null,
        effectiveFrom: dateToIso(row.effective_from),
        effectiveTo: dateToIso(row.effective_to),
        visual: row.visual_json ?? {},
        createdAt: dateToIso(row.created_at) ?? ''
    };
}

function bindingModeForRole(
    device: VirtualDeviceLockRow,
    roleKey: string
): VirtualDeviceProfileRole['historyMode'] {
    if (!device.profile_roles || device.profile_roles.length === 0) {
        return 'linked';
    }
    const role = device.profile_roles.find((candidate) => {
        return candidate.roleKey === roleKey;
    });
    if (role) return role.historyMode;
    throw RpcError.InvalidParams('roleKey is not defined by profile', [
        {field: 'roleKey', error: 'unknown profile role', code: 'unknown_role'}
    ]);
}

function bindingSource(
    row: VirtualDeviceBindingRow
): VirtualDeviceBindingSourceRef {
    return {
        deviceExternalId: row.source_external_id,
        componentKey: row.source_component_key,
        ...(row.source_dynamic_category
            ? {dynamicCategory: row.source_dynamic_category as never}
            : {})
    };
}

function deviceName(row: SourceCandidateDeviceRow): string {
    return (
        stringValue(recordAt(row.jdoc ?? {}, 'info').name) ??
        stringValue(recordAt(row.jdoc ?? {}, 'settings').name) ??
        row.external_id
    );
}

function dateToIso(value: Date | string | null): string | null {
    if (value === null) return null;
    if (value instanceof Date) return value.toISOString();
    return value;
}

function requireBindingRow(
    rows: VirtualDeviceBindingRow[],
    bindingId: string
): VirtualDeviceBindingRow {
    const row = rows[0];
    if (!row) throw RpcError.NotFound('virtual_binding', bindingId);
    return row;
}

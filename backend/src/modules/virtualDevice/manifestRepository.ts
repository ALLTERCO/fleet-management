import {randomUUID} from 'node:crypto';
import log4js from 'log4js';
import RpcError from '../../rpc/RpcError';
import type {
    VirtualDeviceBindingDto,
    VirtualDeviceBindingSourceRef,
    VirtualDeviceDto,
    VirtualDeviceManifest,
    VirtualDeviceManifestApplyDto,
    VirtualDeviceManifestBinding,
    VirtualDeviceManifestChange,
    VirtualDeviceManifestDevice,
    VirtualDeviceManifestOutcome,
    VirtualDeviceManifestPlanDto,
    VirtualDeviceManifestProblem,
    VirtualDeviceManifestProfile,
    VirtualDeviceProfileDto
} from '../../types/api/virtualdevice';
import * as postgres from '../PostgresProvider';
import {
    createVirtualDeviceBinding,
    listVirtualDeviceBindings,
    replaceVirtualDeviceBinding
} from './bindingRepository';
import {createPerOrgProfile, validateProfileRoles} from './profileRepository';
import {
    createVirtualDevice,
    getVirtualDevice,
    listVirtualDevices,
    updateVirtualDevice
} from './repository';

interface ManifestDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
    withTransaction<T>(
        fn: (client: {query: ManifestDeps['queryRows']}) => Promise<T>
    ): Promise<T>;
    makeId(): string;
}

interface ProfileRow {
    id: string;
    organization_id: string;
    key: string;
    name: string;
    version: number | string;
    roles_json: VirtualDeviceProfileDto['roles'];
    metadata: Record<string, unknown> | null;
}

interface ExportBindingRow {
    external_id: string;
    role_key: string;
    source_external_id: string;
    source_component_key: string;
    source_dynamic_category: string | null;
    mode: VirtualDeviceBindingDto['mode'];
    effective_from: Date | string;
}

interface AlertReferenceRow {
    id: number;
    name: string;
    kind: string;
    scope: Record<string, unknown>;
    config: Record<string, unknown>;
}

const logger = log4js.getLogger('VirtualDeviceManifest');
const MANIFEST_VERSION = 'fleet.shelly.cloud/v1';

const defaultDeps: ManifestDeps = {
    queryRows: postgres.queryRows,
    withTransaction: postgres.withQueryTransaction,
    makeId: randomUUID
};

export function validateVirtualDeviceManifest(
    manifest: VirtualDeviceManifest
): VirtualDeviceManifestPlanDto {
    const errors = manifestValidationErrors(manifest);
    return {valid: errors.length === 0, changes: [], errors, remaps: []};
}

export async function planVirtualDeviceManifest(
    organizationId: string,
    manifest: VirtualDeviceManifest,
    deps: ManifestDeps = defaultDeps
): Promise<VirtualDeviceManifestPlanDto> {
    const validation = validateVirtualDeviceManifest(manifest);
    if (!validation.valid) return validation;
    const profiles = await listProfiles(organizationId, deps);
    const devices = await listManifestTargetDevices(
        organizationId,
        manifest,
        deps
    );
    const sources = await listSourceExternalIds(organizationId, manifest, deps);
    const existingBindings = await listExistingActiveBindings(
        organizationId,
        manifest,
        deps
    );
    const changes = [
        ...profileChanges(manifest, profiles),
        ...deviceChanges(manifest, devices),
        ...bindingChanges(manifest, existingBindings),
        ...alertReferenceChanges(manifest, devices)
    ];
    const errors = missingReferenceErrors(manifest, profiles, devices, sources);
    const remaps = explicitRemaps(manifest);
    return {valid: errors.length === 0, changes, errors, remaps};
}

function alertReferenceChanges(
    manifest: VirtualDeviceManifest,
    devices: Set<string>
): VirtualDeviceManifestChange[] {
    const refs = manifest.spec.alertReferences ?? [];
    return refs.map((ref) => {
        const cited = collectDeviceIdsFromAlert(ref);
        const missing = cited.filter(
            (id) => !devices.has(id) && !manifestHasDevice(manifest, id)
        );
        return {
            action: 'skip' as const,
            resourceType: 'binding' as const,
            ref: `alert:${ref.name}`,
            reason:
                missing.length > 0
                    ? `references missing devices: ${missing.join(', ')}`
                    : 'apply does not import alert rules; recreate in target if needed'
        };
    });
}

function manifestHasDevice(
    manifest: VirtualDeviceManifest,
    externalId: string
): boolean {
    return (manifest.spec.devices ?? []).some(
        (d) => d.externalId === externalId
    );
}

// Walks the JSON for strings that look like device external IDs.
function collectDeviceIdsFromAlert(
    ref: VirtualDeviceManifest['spec']['alertReferences'] extends
        | readonly (infer R)[]
        | undefined
        ? R
        : never
): string[] {
    const ids = new Set<string>();
    const visit = (value: unknown): void => {
        if (typeof value === 'string') {
            if (/^(shelly|vdev_|blu_)/.test(value)) ids.add(value);
            return;
        }
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') {
            for (const v of Object.values(value as Record<string, unknown>)) {
                visit(v);
            }
        }
    };
    visit(ref.scope);
    visit(ref.config);
    return [...ids];
}

export async function exportVirtualDeviceManifest(
    organizationId: string,
    externalIds?: readonly string[],
    deps: ManifestDeps = defaultDeps
): Promise<VirtualDeviceManifest> {
    const devices = await listVirtualDevices(
        organizationId,
        {
            limit: 0,
            offset: 0
        },
        deps as never
    );
    const selected = selectDevices(devices.items, externalIds);
    const bindings = await exportedBindings(organizationId, selected, deps);
    const profileRows = await exportedProfileRows(
        organizationId,
        selected,
        deps
    );
    const profileRefs = profileRefsById(profileRows);
    const alertReferences = await exportedAlertReferences(
        organizationId,
        selected,
        deps
    );
    return {
        apiVersion: MANIFEST_VERSION,
        kind: 'VirtualDeviceBundle',
        spec: {
            profiles: profileRows.map(rowToManifestProfile),
            devices: selected.map((device) =>
                deviceToManifest(device, profileRefs)
            ),
            bindings,
            alertReferences
        }
    };
}

export async function applyVirtualDeviceManifest(
    organizationId: string,
    manifest: VirtualDeviceManifest,
    actorId: string | null,
    deps: ManifestDeps = defaultDeps
): Promise<VirtualDeviceManifestApplyDto> {
    const plan = await planVirtualDeviceManifest(
        organizationId,
        manifest,
        deps
    );
    if (!plan.valid) return {applied: false, plan, outcomes: []};
    const outcomes: VirtualDeviceManifestOutcome[] = [];
    const failed = await runApplyStages(
        organizationId,
        manifest,
        actorId,
        outcomes,
        deps
    );
    if (failed) return {applied: false, plan, outcomes};
    return {
        applied: true,
        plan: await planVirtualDeviceManifest(organizationId, manifest, deps),
        outcomes
    };
}

// Returns true when ROLLBACK fired; outcomes already carry the fail reason
// pushed by the helper that threw.
async function runApplyStages(
    organizationId: string,
    manifest: VirtualDeviceManifest,
    actorId: string | null,
    outcomes: VirtualDeviceManifestOutcome[],
    deps: ManifestDeps
): Promise<boolean> {
    try {
        await deps.withTransaction(async (tx) => {
            const txDeps = participatingDeps(tx, deps);
            await applyProfiles(organizationId, manifest, outcomes, txDeps);
            await applyDevices(organizationId, manifest, outcomes, txDeps);
            await applyBindings(
                organizationId,
                manifest,
                actorId,
                outcomes,
                txDeps
            );
        });
        return false;
    } catch (err) {
        // Log the stack — outcomes carry the reason, not the trace.
        logger.warn('virtual device manifest apply rolled back: %s', err);
        return true;
    }
}

// Rebinds withTransaction so inner helpers participate in the outer tx
// instead of opening a fresh one (which would escape ROLLBACK).
function participatingDeps(
    tx: {query: ManifestDeps['queryRows']},
    deps: ManifestDeps
): ManifestDeps {
    return {
        queryRows: tx.query,
        withTransaction: (fn) => fn(tx),
        makeId: deps.makeId
    };
}

function manifestValidationErrors(
    manifest: VirtualDeviceManifest
): VirtualDeviceManifestProblem[] {
    return [
        ...duplicateProfileErrors(manifest.spec.profiles ?? []),
        ...duplicateManifestKeyErrors(
            'devices',
            manifest.spec.devices ?? [],
            (device) => device.externalId
        ),
        ...duplicateBindingErrors(manifest.spec.bindings ?? []),
        ...profileRoleErrors(manifest.spec.profiles ?? [])
    ];
}

function duplicateProfileErrors(
    profiles: readonly VirtualDeviceManifestProfile[]
): VirtualDeviceManifestProblem[] {
    return duplicateManifestKeyErrors('profiles', profiles, (profile) =>
        profileRef(profile.key, profile.version ?? 1)
    );
}

function duplicateManifestKeyErrors<T>(
    field: string,
    items: readonly T[],
    keyOf: (item: T) => string
): VirtualDeviceManifestProblem[] {
    const seen = new Set<string>();
    const errors: VirtualDeviceManifestProblem[] = [];
    items.forEach((item, index) => {
        const value = keyOf(item);
        if (!seen.has(value)) {
            seen.add(value);
            return;
        }
        errors.push({
            field: `${field}.${index}`,
            code: 'duplicate',
            message: `${value} must be unique`
        });
    });
    return errors;
}

function duplicateBindingErrors(
    bindings: readonly VirtualDeviceManifestBinding[]
): VirtualDeviceManifestProblem[] {
    const seen = new Set<string>();
    const errors: VirtualDeviceManifestProblem[] = [];
    bindings.forEach((binding, index) => {
        const key = `${binding.externalId}:${binding.roleKey}`;
        if (!seen.has(key)) {
            seen.add(key);
            return;
        }
        errors.push({
            field: `bindings.${index}`,
            code: 'duplicate_binding',
            message: 'externalId and roleKey must be unique together'
        });
    });
    return errors;
}

function profileRoleErrors(
    profiles: readonly VirtualDeviceManifestProfile[]
): VirtualDeviceManifestProblem[] {
    return profiles.flatMap((profile, index) =>
        validateProfileRoles(profile.roles).errors.map((error) => ({
            field: `profiles.${index}.${error.field}`,
            code: error.code,
            message: error.error
        }))
    );
}

async function listProfiles(
    organizationId: string,
    deps: ManifestDeps
): Promise<Map<string, ProfileRow>> {
    const rows = await deps.queryRows<ProfileRow>(
        `SELECT id, organization_id, key, name, version, roles_json, metadata
           FROM device.virtual_device_profile
          WHERE organization_id = $1
            AND deleted_at IS NULL`,
        [organizationId]
    );
    return new Map(rows.map((row) => [profileRef(row.key, row.version), row]));
}

async function listManifestTargetDevices(
    organizationId: string,
    manifest: VirtualDeviceManifest,
    deps: ManifestDeps
): Promise<Set<string>> {
    const ids = manifest.spec.devices?.map((device) => device.externalId) ?? [];
    if (ids.length === 0) return new Set();
    const rows = await deps.queryRows<{external_id: string}>(
        `SELECT dl.external_id
           FROM device.virtual_device vd
           JOIN device.list dl
             ON dl.id = vd.device_list_id
            AND dl.organization_id = vd.organization_id
          WHERE vd.organization_id = $1
            AND dl.external_id = ANY($2::varchar[])
            AND vd.deleted_at IS NULL`,
        [organizationId, ids]
    );
    return new Set(rows.map((row) => row.external_id));
}

async function listExistingActiveBindings(
    organizationId: string,
    manifest: VirtualDeviceManifest,
    deps: ManifestDeps
): Promise<Set<string>> {
    const targets = (manifest.spec.bindings ?? []).map((b) =>
        deviceExternalId(b, manifest)
    );
    if (targets.length === 0) return new Set();
    const rows = await deps.queryRows<{external_id: string; role_key: string}>(
        `SELECT dl.external_id, b.role_key
           FROM device.virtual_device vd
           JOIN device.list dl
             ON dl.id = vd.device_list_id
            AND dl.organization_id = vd.organization_id
           JOIN device.virtual_device_binding b
             ON b.virtual_device_list_id = vd.device_list_id
            AND b.organization_id = vd.organization_id
            AND b.effective_to IS NULL
          WHERE vd.organization_id = $1
            AND dl.external_id = ANY($2::varchar[])
            AND vd.deleted_at IS NULL`,
        [organizationId, [...new Set(targets)]]
    );
    return new Set(rows.map((r) => `${r.external_id}:${r.role_key}`));
}

async function listSourceExternalIds(
    organizationId: string,
    manifest: VirtualDeviceManifest,
    deps: ManifestDeps
): Promise<Set<string>> {
    const sources = uniqueStrings(
        (manifest.spec.bindings ?? []).map((binding) =>
            sourceExternalId(binding, manifest)
        )
    );
    if (sources.length === 0) return new Set();
    const rows = await deps.queryRows<{external_id: string}>(
        `SELECT external_id
           FROM device.list
          WHERE organization_id = $1
            AND external_id = ANY($2::varchar[])`,
        [organizationId, sources]
    );
    return new Set(rows.map((row) => row.external_id));
}

function profileChanges(
    manifest: VirtualDeviceManifest,
    profiles: Map<string, ProfileRow>
): VirtualDeviceManifestChange[] {
    return (manifest.spec.profiles ?? []).map((profile) => ({
        action: profiles.has(profileRef(profile.key, profile.version ?? 1))
            ? 'skip'
            : 'create',
        resourceType: 'profile',
        ref: profileRef(profile.key, profile.version ?? 1),
        reason: 'profile manifest entry'
    }));
}

function deviceChanges(
    manifest: VirtualDeviceManifest,
    devices: Set<string>
): VirtualDeviceManifestChange[] {
    return (manifest.spec.devices ?? []).map((device) => ({
        action: devices.has(deviceExternalId(device, manifest))
            ? 'update'
            : 'create',
        resourceType: 'device',
        ref: deviceExternalId(device, manifest),
        reason: 'virtual device manifest entry'
    }));
}

function bindingChanges(
    manifest: VirtualDeviceManifest,
    existingBindings: Set<string>
): VirtualDeviceManifestChange[] {
    return (manifest.spec.bindings ?? []).map((binding) => {
        const ref = `${deviceExternalId(binding, manifest)}:${binding.roleKey}`;
        return {
            action: existingBindings.has(ref) ? 'replace' : 'create',
            resourceType: 'binding',
            ref,
            reason: 'virtual binding manifest entry'
        };
    });
}

function missingReferenceErrors(
    manifest: VirtualDeviceManifest,
    profiles: Map<string, ProfileRow>,
    devices: Set<string>,
    sources: Set<string>
): VirtualDeviceManifestProblem[] {
    return [
        ...missingProfileErrors(manifest, profiles),
        ...missingDeviceErrors(manifest, devices),
        ...missingSourceErrors(manifest, sources)
    ];
}

function missingProfileErrors(
    manifest: VirtualDeviceManifest,
    profiles: Map<string, ProfileRow>
): VirtualDeviceManifestProblem[] {
    const bundled = new Set(
        (manifest.spec.profiles ?? []).map((profile) =>
            profileRef(profile.key, profile.version ?? 1)
        )
    );
    return (manifest.spec.devices ?? [])
        .filter((device) => device.profileKey)
        .map((device) =>
            profileRef(
                profileKeyForDevice(device, manifest) ?? '',
                device.profileVersion ?? 1
            )
        )
        .filter((ref) => !bundled.has(ref) && !profiles.has(ref))
        .map((ref) => ({
            field: 'devices.profileKey',
            code: 'missing_profile',
            message: `profile ${ref} is not present`
        }));
}

function missingDeviceErrors(
    manifest: VirtualDeviceManifest,
    devices: Set<string>
): VirtualDeviceManifestProblem[] {
    const bundled = new Set(
        (manifest.spec.devices ?? []).map((device) =>
            deviceExternalId(device, manifest)
        )
    );
    return (manifest.spec.bindings ?? [])
        .map((binding) => deviceExternalId(binding, manifest))
        .filter(
            (externalId) => !bundled.has(externalId) && !devices.has(externalId)
        )
        .map((externalId) => ({
            field: 'bindings.externalId',
            code: 'missing_device',
            message: `virtual device ${externalId} is not present`
        }));
}

function missingSourceErrors(
    manifest: VirtualDeviceManifest,
    sources: Set<string>
): VirtualDeviceManifestProblem[] {
    return uniqueStrings(
        (manifest.spec.bindings ?? []).map((binding) =>
            sourceExternalId(binding, manifest)
        )
    )
        .filter((source) => !sources.has(source))
        .map((source) => ({
            field: 'bindings.source.deviceExternalId',
            code: 'missing_source',
            message: `source device ${source} is not present`
        }));
}

function explicitRemaps(manifest: VirtualDeviceManifest) {
    const remap = manifest.spec.remap ?? {};
    return [
        ...remapEntries('device' as const, remap.devices),
        ...remapEntries('source' as const, remap.sources),
        ...remapEntries('profile' as const, remap.profiles)
    ];
}

function remapEntries<T extends 'device' | 'source' | 'profile'>(
    kind: T,
    values?: Record<string, string>
): Array<{kind: T; from: string; to: string}> {
    return Object.entries(values ?? {}).map(([from, to]) => ({kind, from, to}));
}

async function applyProfiles(
    organizationId: string,
    manifest: VirtualDeviceManifest,
    outcomes: VirtualDeviceManifestOutcome[],
    deps: ManifestDeps
): Promise<void> {
    const existing = await listProfiles(organizationId, deps);
    const profileDeps = {
        queryRows: deps.queryRows,
        withTransaction: deps.withTransaction as never as (
            fn: (client: never) => Promise<unknown>
        ) => Promise<unknown>,
        makeId: deps.makeId
    };
    for (const profile of manifest.spec.profiles ?? []) {
        const ref = profileRef(profile.key, profile.version ?? 1);
        if (existing.has(ref)) {
            outcomes.push({
                resourceType: 'profile',
                ref,
                outcome: 'skip',
                reason: 'already exists'
            });
            continue;
        }
        try {
            await createPerOrgProfile(
                {
                    organizationId,
                    key: profile.key,
                    name: profile.name,
                    version: profile.version,
                    roles: profile.roles,
                    metadata: profile.metadata
                },
                profileDeps as never
            );
            outcomes.push({resourceType: 'profile', ref, outcome: 'create'});
        } catch (err) {
            outcomes.push({
                resourceType: 'profile',
                ref,
                outcome: 'fail',
                reason: err instanceof Error ? err.message : String(err)
            });
            throw err;
        }
    }
}

async function applyDevices(
    organizationId: string,
    manifest: VirtualDeviceManifest,
    outcomes: VirtualDeviceManifestOutcome[],
    deps: ManifestDeps
): Promise<void> {
    const profiles = await listProfiles(organizationId, deps);
    for (const device of manifest.spec.devices ?? []) {
        const externalId = deviceExternalId(device, manifest);
        const existing = await getVirtualDevice(
            organizationId,
            externalId,
            deps as never
        );
        const profileId = profileIdForDevice(device, profiles, manifest);
        try {
            if (!existing) {
                await createVirtualDevice(
                    {
                        organizationId,
                        kind: device.kind,
                        name: device.name,
                        typeKey: device.typeKey,
                        categoryKey: device.categoryKey,
                        profileId,
                        imageAssetId: device.imageAssetId,
                        locationId: device.locationId ?? undefined,
                        groupIds: device.groupIds,
                        tagIds: device.tagIds,
                        visual: device.visual,
                        metadata: device.metadata
                    },
                    {
                        queryRows: deps.queryRows,
                        withTransaction: deps.withTransaction as never,
                        makeExternalId: () => externalId,
                        makeId: deps.makeId
                    } as never
                );
                outcomes.push({
                    resourceType: 'device',
                    ref: externalId,
                    outcome: 'create'
                });
                continue;
            }
            await updateVirtualDevice(
                organizationId,
                {
                    externalId,
                    expectedRevision: existing.revision,
                    name: device.name,
                    typeKey: device.typeKey,
                    categoryKey: device.categoryKey,
                    imageAssetId: device.imageAssetId,
                    enabled: device.enabled,
                    visual: device.visual,
                    metadata: device.metadata,
                    locationId: device.locationId,
                    groupIds: device.groupIds,
                    tagIds: device.tagIds
                },
                deps as never
            );
            outcomes.push({
                resourceType: 'device',
                ref: externalId,
                outcome: 'update'
            });
        } catch (err) {
            outcomes.push({
                resourceType: 'device',
                ref: externalId,
                outcome: 'fail',
                reason: err instanceof Error ? err.message : String(err)
            });
            throw err;
        }
    }
}

async function applyBindings(
    organizationId: string,
    manifest: VirtualDeviceManifest,
    actorId: string | null,
    outcomes: VirtualDeviceManifestOutcome[],
    deps: ManifestDeps
): Promise<void> {
    const bindingDeps = {
        queryRows: deps.queryRows,
        withTransaction: deps.withTransaction as never,
        makeId: deps.makeId
    } as never;
    // Hoist the per-device binding fetch outside the binding loop so an
    // import with N bindings on the same virtual device stays O(N), not O(N²).
    const bindingsByDevice = new Map<
        string,
        Awaited<ReturnType<typeof listVirtualDeviceBindings>>['items']
    >();
    const devicesByExternalId = new Map<
        string,
        Awaited<ReturnType<typeof requireVirtualDevice>>
    >();
    for (const binding of manifest.spec.bindings ?? []) {
        const externalId = deviceExternalId(binding, manifest);
        const ref = `${externalId}:${binding.roleKey}`;
        try {
            let device = devicesByExternalId.get(externalId);
            if (!device) {
                device = await requireVirtualDevice(
                    organizationId,
                    externalId,
                    deps
                );
                devicesByExternalId.set(externalId, device);
            }
            let bindingsCached = bindingsByDevice.get(externalId);
            if (!bindingsCached) {
                bindingsCached = (
                    await listVirtualDeviceBindings(
                        organizationId,
                        {externalId},
                        bindingDeps
                    )
                ).items;
                bindingsByDevice.set(externalId, bindingsCached);
            }
            const current = activeBinding(bindingsCached, binding.roleKey);
            const source = remappedSource(binding, manifest);
            if (!current) {
                await createVirtualDeviceBinding(
                    organizationId,
                    {
                        externalId,
                        roleKey: binding.roleKey,
                        source,
                        effectiveFrom: binding.effectiveFrom,
                        reason: binding.reason,
                        expectedRevision: device.revision
                    },
                    actorId,
                    bindingDeps
                );
                outcomes.push({
                    resourceType: 'binding',
                    ref,
                    outcome: 'create'
                });
                continue;
            }
            if (sameSource(current.source, source)) {
                outcomes.push({
                    resourceType: 'binding',
                    ref,
                    outcome: 'skip',
                    reason: 'source unchanged'
                });
                continue;
            }
            await replaceVirtualDeviceBinding(
                organizationId,
                {
                    externalId,
                    roleKey: binding.roleKey,
                    source,
                    effectiveFrom: binding.effectiveFrom,
                    reason: binding.reason,
                    expectedRevision: device.revision,
                    idempotencyKey: `manifest:${externalId}:${binding.roleKey}`
                },
                actorId,
                bindingDeps
            );
            outcomes.push({
                resourceType: 'binding',
                ref,
                outcome: 'update'
            });
        } catch (err) {
            outcomes.push({
                resourceType: 'binding',
                ref,
                outcome: 'fail',
                reason: err instanceof Error ? err.message : String(err)
            });
            throw err;
        }
    }
}

async function requireVirtualDevice(
    organizationId: string,
    externalId: string,
    deps: ManifestDeps
): Promise<VirtualDeviceDto> {
    const device = await getVirtualDevice(
        organizationId,
        externalId,
        deps as never
    );
    if (!device) throw RpcError.NotFound('virtual_device', externalId);
    return device;
}

function activeBinding(
    bindings: readonly VirtualDeviceBindingDto[],
    roleKey: string
): VirtualDeviceBindingDto | null {
    return (
        bindings.find(
            (binding) => binding.roleKey === roleKey && !binding.effectiveTo
        ) ?? null
    );
}

function sameSource(
    left: VirtualDeviceBindingSourceRef,
    right: VirtualDeviceBindingSourceRef
): boolean {
    return (
        left.deviceExternalId === right.deviceExternalId &&
        left.componentKey === right.componentKey &&
        left.dynamicCategory === right.dynamicCategory
    );
}

function profileIdForDevice(
    device: VirtualDeviceManifestDevice,
    profiles: Map<string, ProfileRow>,
    manifest: VirtualDeviceManifest
): string | undefined {
    const key = profileKeyForDevice(device, manifest);
    if (!key) return undefined;
    return profiles.get(profileRef(key, device.profileVersion ?? 1))?.id;
}

function profileKeyForDevice(
    device: VirtualDeviceManifestDevice,
    manifest: VirtualDeviceManifest
): string | undefined {
    if (!device.profileKey) return undefined;
    return (
        manifest.spec.remap?.profiles?.[device.profileKey] ?? device.profileKey
    );
}

function selectDevices(
    devices: readonly VirtualDeviceDto[],
    externalIds?: readonly string[]
): VirtualDeviceDto[] {
    if (!externalIds?.length) return [...devices];
    const wanted = new Set(externalIds);
    return devices.filter((device) => wanted.has(device.externalId));
}

async function exportedBindings(
    organizationId: string,
    devices: readonly VirtualDeviceDto[],
    deps: ManifestDeps
): Promise<VirtualDeviceManifestBinding[]> {
    if (devices.length === 0) return [];
    const rows = await deps.queryRows<ExportBindingRow>(
        `SELECT
            dl.external_id,
            b.role_key,
            src.external_id AS source_external_id,
            b.source_component_key,
            b.source_dynamic_category,
            b.mode,
            b.effective_from
           FROM device.virtual_device_binding b
           JOIN device.list dl
             ON dl.id = b.virtual_device_list_id
            AND dl.organization_id = b.organization_id
           JOIN device.list src
             ON src.id = b.source_device_list_id
            AND src.organization_id = b.organization_id
          WHERE b.organization_id = $1
            AND dl.external_id = ANY($2::varchar[])
            AND b.effective_to IS NULL
          ORDER BY dl.external_id, b.role_key`,
        [organizationId, devices.map((device) => device.externalId)]
    );
    return rows.map(rowToManifestBinding);
}

async function exportedProfileRows(
    organizationId: string,
    devices: readonly VirtualDeviceDto[],
    deps: ManifestDeps
): Promise<ProfileRow[]> {
    const profileIds = uniqueStrings(
        devices.flatMap((device) =>
            device.profileId ? [device.profileId] : []
        )
    );
    if (profileIds.length === 0) return [];
    const rows = await deps.queryRows<ProfileRow>(
        `SELECT id, organization_id, key, name, version, roles_json, metadata
           FROM device.virtual_device_profile
          WHERE organization_id = $1
            AND id = ANY($2::uuid[])
            AND deleted_at IS NULL
        ORDER BY key, version`,
        [organizationId, profileIds]
    );
    return rows;
}

async function exportedAlertReferences(
    organizationId: string,
    devices: readonly VirtualDeviceDto[],
    deps: ManifestDeps
): Promise<VirtualDeviceManifest['spec']['alertReferences']> {
    if (devices.length === 0) return [];
    const ids = new Set(devices.map((d) => d.externalId));
    // Broad text-LIKE pre-filter, then re-check the parsed JSON in JS so an
    // alert mentioning `vdev_temp` doesn't false-match `vdev_temperature`.
    const rows = await deps.queryRows<AlertReferenceRow>(
        `SELECT id, name, kind, scope, config
           FROM notifications.alert_rules
          WHERE organization_id = $1
            AND (
                scope::text LIKE ANY($2::text[])
                OR config::text LIKE ANY($2::text[])
            )
          ORDER BY id`,
        [organizationId, [...ids].map((id) => `%${id}%`)]
    );
    return rows
        .filter((row) => {
            const cited = new Set<string>();
            collectStringsInto(row.scope, cited);
            collectStringsInto(row.config, cited);
            for (const id of ids) if (cited.has(id)) return true;
            return false;
        })
        .map((row) => ({
            id: row.id,
            name: row.name,
            kind: row.kind,
            scope: row.scope,
            config: row.config
        }));
}

function collectStringsInto(value: unknown, out: Set<string>): void {
    if (typeof value === 'string') {
        out.add(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const v of value) collectStringsInto(v, out);
        return;
    }
    if (value && typeof value === 'object') {
        for (const v of Object.values(value as Record<string, unknown>)) {
            collectStringsInto(v, out);
        }
    }
}

function deviceToManifest(
    device: VirtualDeviceDto,
    profileRefs: Map<string, {key: string; version: number}>
): VirtualDeviceManifestDevice {
    const profile = device.profileId ? profileRefs.get(device.profileId) : null;
    return {
        externalId: device.externalId,
        kind: device.kind,
        name: device.name,
        typeKey: device.typeKey,
        ...(device.categoryKey ? {categoryKey: device.categoryKey} : {}),
        ...(profile
            ? {profileKey: profile.key, profileVersion: profile.version}
            : {}),
        ...(device.imageAssetId ? {imageAssetId: device.imageAssetId} : {}),
        ...(device.locationId !== null ? {locationId: device.locationId} : {}),
        ...(device.groupIds.length ? {groupIds: device.groupIds} : {}),
        ...(device.tagIds.length ? {tagIds: device.tagIds} : {}),
        enabled: device.enabled,
        visual: device.visual,
        metadata: device.metadata
    };
}

function rowToManifestBinding(
    row: ExportBindingRow
): VirtualDeviceManifestBinding {
    return {
        externalId: row.external_id,
        roleKey: row.role_key,
        source: {
            deviceExternalId: row.source_external_id,
            componentKey: row.source_component_key,
            ...(row.source_dynamic_category
                ? {dynamicCategory: row.source_dynamic_category as never}
                : {})
        },
        mode: row.mode,
        effectiveFrom: dateToIso(row.effective_from)
    };
}

function rowToManifestProfile(row: ProfileRow): VirtualDeviceManifestProfile {
    return {
        key: row.key,
        name: row.name,
        version: Number(row.version),
        roles: row.roles_json,
        metadata: row.metadata ?? {}
    };
}

function profileRefsById(
    rows: readonly ProfileRow[]
): Map<string, {key: string; version: number}> {
    return new Map(
        rows.map((row) => [
            row.id,
            {key: row.key, version: Number(row.version)}
        ])
    );
}

function remappedSource(
    binding: VirtualDeviceManifestBinding,
    manifest: VirtualDeviceManifest
): VirtualDeviceBindingSourceRef {
    return {
        ...binding.source,
        deviceExternalId: sourceExternalId(binding, manifest)
    };
}

function sourceExternalId(
    binding: VirtualDeviceManifestBinding,
    manifest: VirtualDeviceManifest
): string {
    return (
        manifest.spec.remap?.sources?.[binding.source.deviceExternalId] ??
        binding.source.deviceExternalId
    );
}

function deviceExternalId(
    item: {externalId: string},
    manifest: VirtualDeviceManifest
): string {
    return manifest.spec.remap?.devices?.[item.externalId] ?? item.externalId;
}

function profileRef(key: string, version: number | string): string {
    return `${key}@${Number(version) || 1}`;
}

function uniqueStrings(values: readonly string[]): string[] {
    return [...new Set(values.filter(Boolean))].sort();
}

function dateToIso(value: Date | string): string {
    return value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString();
}

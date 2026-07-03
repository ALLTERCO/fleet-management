// Reverse of Profile.MatchSources: given a device, return the top-N profiles
// most likely to fit it. The wizard uses this to narrow the picker from N
// profiles to a confidence-ranked shortlist. Honest about ambiguity — for a
// generic relay, every confidence will be low and the UI should let the user
// pick from the full library instead.

import {suggestProfileKeysForModel} from '../../config/deviceModelProfileHints';
import {tuning} from '../../config/tuning';
import RpcError from '../../rpc/RpcError';
import type {
    BluetoothDeviceDto,
    VirtualDeviceProfileRole,
    VirtualDeviceProfileSuggestCandidateDto,
    VirtualDeviceProfileSuggestDto,
    VirtualDeviceProfileSuggestParams,
    VirtualDeviceProfileSuggestRoleFitDto
} from '../../types/api/virtualdevice';
import * as postgres from '../PostgresProvider';
import {getBluetoothDevice} from './bluetoothRepository';
import {classifyBluComponent, scoreCandidate} from './profileMatchSources';
import {
    classifySourceComponent,
    collectBindableComponentKeys
} from './sourceClassifier';

interface SuggestDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
    listBluetoothPage?(
        organizationId: string
    ): Promise<{items: readonly BluetoothDeviceDto[]}>;
}

interface ProfileRow {
    id: string;
    key: string;
    name: string;
    version: number;
    roles_json: VirtualDeviceProfileRole[];
}

interface PhysicalDeviceRow {
    external_id: string;
    kind: string | null;
    jdoc: Record<string, unknown> | null;
}

type Classification = ReturnType<typeof classifySourceComponent>;

interface ResolvedDevice {
    externalId: string;
    kind: 'physical' | 'bluetooth';
    modelHint: string | null;
    classifications: Classification[];
}

const defaultDeps: SuggestDeps = {
    queryRows: postgres.queryRows
};

export async function suggestVirtualDeviceProfileForDevice(
    organizationId: string,
    input: VirtualDeviceProfileSuggestParams,
    deps: SuggestDeps = defaultDeps
): Promise<VirtualDeviceProfileSuggestDto> {
    const device = await resolveDevice(organizationId, input, deps);
    const profiles = await loadProfiles(organizationId, deps);
    const limit = input.limit ?? tuning.virtualDevice.profileSuggestMaxResults;
    const candidates = profiles
        .map((profile) => scoreProfile(profile, device))
        .filter((c): c is VirtualDeviceProfileSuggestCandidateDto => c !== null)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, limit);
    return {
        device: {
            externalId: device.externalId,
            kind: device.kind,
            modelHint: device.modelHint
        },
        candidates
    };
}

async function resolveDevice(
    organizationId: string,
    input: VirtualDeviceProfileSuggestParams,
    deps: SuggestDeps
): Promise<ResolvedDevice> {
    // Suggest scores component shape, not binding shape — virtual unsupported.
    if (input.deviceExternalId.startsWith('vdev_')) {
        throw RpcError.InvalidParams(
            'Profile suggestion is not supported for virtual devices'
        );
    }
    const physical = await loadPhysicalDevice(
        organizationId,
        input.deviceExternalId,
        deps
    );
    if (physical) return physical;
    const bluetooth = await loadBluetoothDevice(
        organizationId,
        input.deviceExternalId,
        deps
    );
    if (bluetooth) return bluetooth;
    throw RpcError.NotFound(
        `device ${input.deviceExternalId} not found in organization`
    );
}

async function loadPhysicalDevice(
    organizationId: string,
    externalId: string,
    deps: SuggestDeps
): Promise<ResolvedDevice | null> {
    const rows = await deps.queryRows<PhysicalDeviceRow>(
        `SELECT external_id, kind, jdoc
           FROM device.list
          WHERE organization_id = $1
            AND external_id = $2
          LIMIT 1`,
        [organizationId, externalId]
    );
    const row = rows[0];
    if (!row) return null;
    const jdoc = row.jdoc ?? {};
    const componentKeys = collectBindableComponentKeys({jdoc});
    const classifications = componentKeys.map((componentKey) =>
        classifySourceComponent({
            deviceExternalId: row.external_id,
            deviceKind: row.kind,
            jdoc,
            componentKey
        })
    );
    return {
        externalId: row.external_id,
        kind: 'physical',
        modelHint: physicalModelHint(jdoc),
        classifications
    };
}

async function loadBluetoothDevice(
    organizationId: string,
    externalId: string,
    deps: SuggestDeps
): Promise<ResolvedDevice | null> {
    // Tests inject listBluetoothPage; prod takes single-row lookup.
    let blu: BluetoothDeviceDto | null;
    if (deps.listBluetoothPage) {
        const page = await deps.listBluetoothPage(organizationId);
        blu = page.items.find((b) => b.externalId === externalId) ?? null;
    } else {
        blu = await getBluetoothDevice(organizationId, externalId);
    }
    if (!blu) return null;
    const classifications = blu.components
        .filter((c) => c.role !== 'identity')
        .map((c) => classifyBluComponent(c));
    return {
        externalId: blu.externalId,
        kind: 'bluetooth',
        modelHint: blu.productName ?? null,
        classifications
    };
}

function physicalModelHint(jdoc: Record<string, unknown>): string | null {
    const info = (jdoc.info as Record<string, unknown> | undefined) ?? {};
    const fromApp = readString(info.app);
    if (fromApp) return fromApp;
    const fromModel = readString(info.model);
    if (fromModel) return fromModel;
    const fromName = readString(info.name);
    return fromName ?? null;
}

function readString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

async function loadProfiles(
    organizationId: string,
    deps: SuggestDeps
): Promise<ProfileRow[]> {
    return deps.queryRows<ProfileRow>(
        `SELECT id, key, name, version, roles_json
           FROM device.virtual_device_profile
          WHERE (organization_id = $1 OR organization_id IS NULL)
            AND deleted_at IS NULL
          ORDER BY key, version DESC`,
        [organizationId]
    );
}

function scoreProfile(
    profile: ProfileRow,
    device: ResolvedDevice
): VirtualDeviceProfileSuggestCandidateDto | null {
    // Null/empty roles_json carries no fit signal; drop the candidate.
    const roles = profile.roles_json ?? [];
    if (roles.length === 0) return null;
    const roleFitness = roles.map((role) =>
        bestFitForRole(role, device.classifications)
    );
    const requiredFits = roleFitness.filter((fit) => fit.required);
    const matchedRequiredFits = requiredFits.filter((fit) => fit.matched);
    if (
        requiredFits.length > 0 &&
        matchedRequiredFits.length < requiredFits.length
    ) {
        return null;
    }
    const totalRequired = requiredFits.length;
    const matchedRequired = matchedRequiredFits.length;
    const coverage = totalRequired === 0 ? 1 : matchedRequired / totalRequired;
    const {confidence, reasons} = confidenceForProfile(
        profile,
        device,
        roleFitness
    );
    return {
        profile: {
            id: profile.id,
            key: profile.key,
            name: profile.name,
            version: profile.version
        },
        confidence,
        coverage,
        matchedRequired,
        totalRequired,
        reasons,
        roleFitness
    };
}

function bestFitForRole(
    role: VirtualDeviceProfileRole,
    classifications: readonly Classification[]
): VirtualDeviceProfileSuggestRoleFitDto {
    let bestScore = 0;
    let bestComponentKey: string | null = null;
    for (const classification of classifications) {
        const scored = scoreCandidate(role, classification);
        if (scored.score > bestScore) {
            bestScore = scored.score;
            bestComponentKey = classification.componentKey;
        }
    }
    return {
        roleKey: role.roleKey,
        required: role.required !== false,
        matched: bestScore > 0,
        bestComponentKey,
        bestScore
    };
}

function confidenceForProfile(
    profile: ProfileRow,
    device: ResolvedDevice,
    roleFitness: readonly VirtualDeviceProfileSuggestRoleFitDto[]
): {confidence: number; reasons: string[]} {
    const reasons: string[] = [];
    let confidence = 0.5;
    reasons.push(
        `${roleFitness.filter((f) => f.matched).length} of ${roleFitness.length} roles fillable`
    );
    // Hint table is the stronger signal; keyword substring is the fallback.
    const modelHintProfiles = suggestProfileKeysForModel(device.modelHint);
    if (modelHintProfiles.includes(profile.key)) {
        confidence += 0.3;
        reasons.push(`device model hint matches profile "${profile.key}"`);
    } else if (
        device.modelHint &&
        modelHintIncludesProfileKey(device.modelHint, profile.key)
    ) {
        confidence += 0.2;
        reasons.push('profile key keyword found in device model');
    }
    const optionalMatched = roleFitness.filter(
        (f) => !f.required && f.matched
    ).length;
    if (optionalMatched > 0) {
        const bump = Math.min(optionalMatched * 0.05, 0.15);
        confidence += bump;
        reasons.push(`${optionalMatched} optional role(s) also fillable`);
    }
    return {confidence: Math.min(confidence, 1), reasons};
}

function modelHintIncludesProfileKey(
    modelHint: string,
    profileKey: string
): boolean {
    const haystack = modelHint.toLowerCase().replace(/[^a-z0-9]/g, '');
    const needle = profileKey.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (needle.length < 3) return false;
    return haystack.includes(needle);
}

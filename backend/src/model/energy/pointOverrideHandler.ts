// Handler for Energy.SetPointOverride — the one fact a device cannot
// state for itself (the electrical domain or tag of an unknown point,
// e.g. a voltmeter that may be AC or DC). It writes the tier-1 operator
// override that fm.energy_classification stores and the classifier reads
// first, then refreshes the in-memory override cache so the next
// NotifyStatus frame uses it immediately. Replaces the old
// Set/Delete/Get classification + preset methods — all other facts are
// auto-derived by the classifier.

import {commodityForTag} from '../../modules/energyClassifier';
import type {EnergyOverrideCache} from '../../modules/energyOverrideCache';
import RpcError from '../../rpc/RpcError';
import type {
    EnergyClassificationRow,
    EnergySetPointOverrideParams,
    EnergySetPointOverrideResponse
} from '../../types/api/energy';
import {
    type DeviceAccessSender,
    senderCanAccessDevice
} from './deviceAccessFilter';

export interface PointOverrideSender extends DeviceAccessSender {
    getUserId?(): string | undefined;
}

// Repo seam — production wiring upserts fm.energy_classification and
// re-seeds the device's override rows. Tests pass a fake.
export interface PointOverrideRepoSeam {
    upsertClassification: (params: {
        device: number;
        componentKey: string;
        tag: EnergyClassificationRow['tag'];
        domain: EnergyClassificationRow['domain'];
        channel: number;
        who: string | null;
    }) => Promise<void>;
    refreshDeviceOverrides: (deviceId: number) => Promise<void>;
}

export interface PointOverrideHandlerDeps {
    sender: PointOverrideSender;
    repo: PointOverrideRepoSeam;
    overrideCache: EnergyOverrideCache;
}

/**
 * Tag and domain were two independent enums, so a point could be declared a
 * water volume AND an electrical mains at once. The commodity derived from that
 * pair went to electricity, and cubic metres were summed as watt-hours.
 */
function assertTagAgreesWithDomain(
    tag: EnergyClassificationRow['tag'],
    domain: EnergyClassificationRow['domain']
): void {
    if (tag === 'volume_returned_m3' && domain !== 'gas') {
        throw RpcError.InvalidParams(
            "tag 'volume_returned_m3' is an explicit gas injection counter and requires electricalDomain 'gas'"
        );
    }
    const implied = commodityForTag(tag);
    if (implied === null || implied === 'electricity') return;
    if (ELECTRICAL_DOMAINS.has(domain)) {
        throw RpcError.InvalidParams(
            `tag '${tag}' measures ${implied}, so it cannot also be '${domain}'. ` +
                `Use 'unspecified'${implied === 'water' ? " or 'gas'" : ''} instead.`
        );
    }
}

const ELECTRICAL_DOMAINS: ReadonlySet<string> = new Set([
    'ac_mains',
    'dc_pv',
    'dc_battery',
    'dc_bus'
]);

export async function handleSetPointOverride(
    params: EnergySetPointOverrideParams,
    deps: PointOverrideHandlerDeps
): Promise<EnergySetPointOverrideResponse> {
    if (!(await senderCanAccessDevice(params.deviceId, deps.sender))) {
        throw RpcError.Domain('PermissionDenied');
    }
    assertTagAgreesWithDomain(params.tag, params.electricalDomain);
    await deps.repo.upsertClassification({
        device: params.deviceId,
        componentKey: params.componentKey,
        tag: params.tag,
        domain: params.electricalDomain,
        channel: params.channel,
        who: deps.sender.getUserId?.() ?? null
    });
    deps.overrideCache.set(params.deviceId, params.componentKey, {
        tag: params.tag,
        domain: params.electricalDomain,
        channel: params.channel
    });
    await deps.repo.refreshDeviceOverrides(params.deviceId);
    return {ok: true};
}

// A logical meter as the scope of a bill. The network bills a connection, so
// the meter's whole point set is the unit: every device it reads, every
// channel it owns. Anything less is a fraction of a connection, and every
// refusal below exists to avoid billing one.

import RpcError from '../../rpc/RpcError';
import type {EnergyCommodity, EnergyLogicalMeter} from '../../types/api/energy';
import {utilityTypeForCommodity} from '../../types/api/energy';

/** Reads product-wide identities for the meter's stored device ids. */
interface ExternalIdReader {
    resolveExternalIds(
        internalIds: readonly number[]
    ): Promise<Readonly<Record<number, string>>>;
}

interface DeviceAccessFilter {
    filterAccessibleDevices(ids: string[]): Promise<Set<string>>;
}

export interface MeterBillingScope {
    internalIds: readonly number[];
    idMap: Readonly<Record<number, string>>;
    /** `${externalId}|${channel}` for exactly the points the meters own. */
    channelKeys: Set<string>;
}

export async function resolveMeterBillingScope(input: {
    meterIds: readonly number[];
    meters: readonly EnergyLogicalMeter[];
    commodity: EnergyCommodity;
    repo: ExternalIdReader;
    sender: DeviceAccessFilter;
}): Promise<MeterBillingScope> {
    const selected = selectMeters(input.meterIds, input.meters);
    for (const meter of selected) assertMeterIsBillable(meter, input.commodity);
    const internalIds = meteredDeviceIds(selected);
    const idMap = await input.repo.resolveExternalIds(internalIds);
    assertEveryDeviceResolved(internalIds, idMap);
    await assertCallerReadsWholeConnection(idMap, input.sender);
    return {
        internalIds,
        idMap,
        channelKeys: pointKeys(selected, idMap)
    };
}

function selectMeters(
    meterIds: readonly number[],
    meters: readonly EnergyLogicalMeter[]
): EnergyLogicalMeter[] {
    const byId = new Map(meters.map((meter) => [meter.id, meter]));
    return meterIds.map((id) => {
        const meter = byId.get(id);
        if (!meter) throw RpcError.NotFound('meter', String(id));
        return meter;
    });
}

function assertMeterIsBillable(
    meter: EnergyLogicalMeter,
    commodity: EnergyCommodity
): void {
    if (meter.aggregationMode === 'formula') {
        throw meterRefusal(
            `Meter ${meter.id} is a calculated meter. It combines other meters rather than measuring a connection, so it cannot be billed.`
        );
    }
    const expected = utilityTypeForCommodity(commodity);
    if (meter.utilityType !== expected) {
        throw meterRefusal(
            `Meter ${meter.id} meters ${meter.utilityType}, not the ${commodity} connection being billed.`
        );
    }
    if (meter.points.length === 0) {
        throw meterRefusal(`Meter ${meter.id} has no metering points.`);
    }
}

function meteredDeviceIds(meters: readonly EnergyLogicalMeter[]): number[] {
    const ids = new Set<number>();
    for (const meter of meters) {
        for (const point of meter.points) ids.add(point.deviceId);
    }
    return [...ids].sort((left, right) => left - right);
}

/** A device the meter names but Fleet no longer holds would silently shrink
 * the connection, so the gap is an error rather than a smaller bill. */
function assertEveryDeviceResolved(
    internalIds: readonly number[],
    idMap: Readonly<Record<number, string>>
): void {
    const missing = internalIds.filter((id) => idMap[id] === undefined);
    if (missing.length > 0) {
        throw meterRefusal(
            `The connection names devices Fleet no longer holds: ${missing.join(', ')}.`
        );
    }
}

/** Partial read access would understate both the usage and the demand peak, so
 * a caller who cannot see the whole connection is refused rather than shown a
 * smaller bill that looks complete. */
async function assertCallerReadsWholeConnection(
    idMap: Readonly<Record<number, string>>,
    sender: DeviceAccessFilter
): Promise<void> {
    const externalIds = Object.values(idMap);
    const accessible = await sender.filterAccessibleDevices(externalIds);
    const hidden = externalIds.filter((id) => !accessible.has(id));
    if (hidden.length > 0) {
        throw RpcError.Domain('PermissionDenied', {
            message: `The connection includes devices you cannot read: ${hidden.join(', ')}.`
        });
    }
}

function pointKeys(
    meters: readonly EnergyLogicalMeter[],
    idMap: Readonly<Record<number, string>>
): Set<string> {
    const keys = new Set<string>();
    for (const meter of meters) {
        for (const point of meter.points) {
            keys.add(`${idMap[point.deviceId]}|${point.channel}`);
        }
    }
    return keys;
}

function meterRefusal(message: string): RpcError {
    return RpcError.Domain('ValidationFailed', {message, field: 'meterIds'});
}

/**
 * True when the meters own every channel their devices actually recorded.
 * Demand is measured per device — `fn_device_power_avg` takes no channel — so
 * a meter owning only some of a device's channels cannot have its peak read
 * from whole-device power. An unattributable row counts as not owned, because
 * a peak that might include foreign load must not be billed as the
 * connection's.
 */
export function meterOwnsEveryMeasuredChannel(input: {
    channelKeys: ReadonlySet<string>;
    idMap: Readonly<Record<number, string>>;
    measured: ReadonlyArray<{device: number; channel: number | null}>;
}): boolean {
    return input.measured.every(
        (row) =>
            row.channel !== null &&
            input.channelKeys.has(`${input.idMap[row.device]}|${row.channel}`)
    );
}

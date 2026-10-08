import type {Energy15minByChannelRow} from '../../modules/repositories/EnergyRepository';
import type {GasConversionRepository} from '../../modules/repositories/GasConversionRepository';
import RpcError from '../../rpc/RpcError';
import type {Energy15minCostRow} from './energyCostEngine';
import {buildEnergyCostRows, displayBucketKey} from './energyReportCost';
import {
    convertGasVolume,
    type GasCalorificValue,
    type GasConversionDisclosure,
    type GasConversionProfile,
    gasDayFor
} from './gasConversion';
import type {TariffQuantityMetric} from './tariffQuantity';

export interface PreparedGasReportConversion {
    currentRows: Energy15minCostRow[];
    priorByDevice: Map<number, number>;
    disclosures: GasConversionDisclosure[];
    pointQuantity(input: {
        device: number;
        channel: number;
        bucket: string;
        storedValue: number;
        direction?: 'consumption' | 'returned';
    }): number;
    displayQuantity(input: {
        device: number;
        bucket: string;
        storedValue: number;
        direction?: 'consumption' | 'returned';
    }): number;
}

/**
 * Preload the versioned conversion inputs once, then expose synchronous
 * lookups to the bounded report streams. The stream and cost pass therefore
 * consume the same converted billed quantities; neither can silently fall
 * back to raw volume.
 */
export async function prepareGasReportConversion(input: {
    orgId: string;
    deviceMap: ReadonlyMap<number, string>;
    currentRawRows: readonly Energy15minByChannelRow[];
    priorRawRows: readonly Energy15minByChannelRow[];
    rawMetric: TariffQuantityMetric;
    targetMetric: TariffQuantityMetric;
    granularity: string;
    repo: Pick<
        GasConversionRepository,
        'listProfiles' | 'resolveCalorificValues'
    >;
}): Promise<PreparedGasReportConversion> {
    if (
        input.rawMetric.commodity !== 'gas' ||
        input.rawMetric.billedUnit !== 'm3' ||
        input.targetMetric.requiresConversion !== 'gas'
    ) {
        throw unavailable(
            'Gas report conversion received an unsupported unit pair.'
        );
    }
    const current = buildEnergyCostRows(input.currentRawRows, input.rawMetric);
    const prior = buildEnergyCostRows(input.priorRawRows, input.rawMetric);
    const allRows = [...current, ...prior];
    const profileRanges = await loadProfiles(input, allRows);
    const selections = allRows.map((row) => ({
        row,
        profile: selectGasProfile(
            profileRanges.get(pointKey(row.device, row.channel)) ?? [],
            row.bucket,
            input.targetMetric.billedUnit,
            input.deviceMap.get(row.device) ?? '',
            row.channel
        )
    }));
    const calorificValues = await loadCalorificValues(input, selections);
    const convertedByRow = new Map<Energy15minCostRow, Energy15minCostRow>();
    const disclosureByProfile = new Map<number, GasConversionDisclosure>();
    for (const {row, profile} of selections) {
        const values = calorificValues.get(profile.pricingZoneId) ?? [];
        const consumption = convertDirection(
            row.consumptionUnits,
            row.bucket,
            profile,
            values
        );
        const returned = convertDirection(
            row.returnedUnits,
            row.bucket,
            profile,
            values
        );
        convertedByRow.set(row, {
            ...row,
            consumptionUnits: consumption.quantity,
            returnedUnits: returned.quantity
        });
        const disclosure = consumption.disclosure ?? returned.disclosure;
        if (disclosure) mergeDisclosure(disclosureByProfile, disclosure);
    }

    const currentRows = current.map((row) =>
        requiredConverted(convertedByRow, row)
    );
    const point = new Map<string, number>();
    const display = new Map<string, number>();
    for (const row of currentRows) {
        point.set(pointBucketKey(row, 'consumption'), row.consumptionUnits);
        point.set(pointBucketKey(row, 'returned'), row.returnedUnits);
        const consumptionKey = displayDirectionKey(
            row.bucket,
            input.granularity,
            row.device,
            'consumption'
        );
        const returnedKey = displayDirectionKey(
            row.bucket,
            input.granularity,
            row.device,
            'returned'
        );
        display.set(
            consumptionKey,
            (display.get(consumptionKey) ?? 0) + row.consumptionUnits
        );
        display.set(
            returnedKey,
            (display.get(returnedKey) ?? 0) + row.returnedUnits
        );
    }
    const priorByDevice = new Map<number, number>();
    for (const row of prior) {
        priorByDevice.set(
            row.device,
            (priorByDevice.get(row.device) ?? 0) +
                requiredConverted(convertedByRow, row).consumptionUnits
        );
    }
    return {
        currentRows,
        priorByDevice,
        disclosures: [...disclosureByProfile.values()].sort(
            (left, right) => left.profileId - right.profileId
        ),
        pointQuantity: ({
            device,
            channel,
            bucket,
            storedValue,
            direction = 'consumption'
        }) =>
            requiredLookup(
                point,
                pointBucketKey({device, channel, bucket}, direction),
                storedValue,
                `15-minute ${direction} service-point`
            ),
        displayQuantity: ({
            device,
            bucket,
            storedValue,
            direction = 'consumption'
        }) =>
            requiredLookup(
                display,
                displayDirectionKey(
                    bucket,
                    input.granularity,
                    device,
                    direction
                ),
                storedValue,
                `${direction} display-bucket`
            )
    };
}

function convertDirection(
    volume: number,
    bucket: string,
    profile: GasConversionProfile,
    calorificValues: readonly GasCalorificValue[]
): {quantity: number; disclosure: GasConversionDisclosure | null} {
    if (Math.abs(volume) <= 1e-12) {
        return {quantity: 0, disclosure: null};
    }
    const result = convertGasVolume({
        profile,
        calorificValues,
        rows: [{bucket, volume}]
    });
    return {quantity: result.billedQuantity, disclosure: result.disclosure};
}

async function loadProfiles(
    input: Parameters<typeof prepareGasReportConversion>[0],
    rows: readonly Energy15minCostRow[]
): Promise<Map<string, GasConversionProfile[]>> {
    const result = new Map<string, GasConversionProfile[]>();
    const buckets = rows.map((row) => new Date(row.bucket).getTime());
    if (buckets.length === 0) return result;
    const from = new Date(Math.min(...buckets) - 86_400_000)
        .toISOString()
        .slice(0, 10);
    const to = new Date(Math.max(...buckets) + 86_400_000)
        .toISOString()
        .slice(0, 10);
    const points = new Map<string, {device: number; channel: number}>();
    for (const row of rows) {
        points.set(pointKey(row.device, row.channel), {
            device: row.device,
            channel: row.channel
        });
    }
    await Promise.all(
        [...points.entries()].map(async ([key, point]) => {
            const deviceExternalId = input.deviceMap.get(point.device) ?? '';
            if (!deviceExternalId) {
                throw unavailable(
                    `No external service-point id maps report device ${point.device}.`
                );
            }
            result.set(
                key,
                await input.repo.listProfiles({
                    orgId: input.orgId,
                    deviceExternalId,
                    channel: point.channel,
                    from,
                    to
                })
            );
        })
    );
    return result;
}

export function selectGasProfile(
    profiles: readonly GasConversionProfile[],
    bucket: string,
    billedUnit: string,
    deviceExternalId: string,
    channel: number
): GasConversionProfile {
    const candidates = profiles
        .filter((profile) => {
            if (!profile.effectiveFrom) return false;
            const day = gasDayFor(
                bucket,
                profile.timezone,
                profile.dayBoundary
            );
            return (
                profile.effectiveFrom <= day &&
                (!profile.effectiveTo || day < profile.effectiveTo)
            );
        })
        .sort((left, right) => {
            const effective = (right.effectiveFrom ?? '').localeCompare(
                left.effectiveFrom ?? ''
            );
            return effective || right.revision - left.revision;
        });
    const profile = candidates[0];
    if (!profile) {
        throw unavailable(
            `No gas conversion profile covers ${deviceExternalId} channel ${channel} at ${bucket}.`
        );
    }
    if (profile.billedUnit !== billedUnit) {
        throw unavailable(
            `Gas profile ${profile.id} bills ${profile.billedUnit}, not ${billedUnit}.`
        );
    }
    return profile;
}

async function loadCalorificValues(
    input: Parameters<typeof prepareGasReportConversion>[0],
    selections: ReadonlyArray<{
        row: Energy15minCostRow;
        profile: GasConversionProfile;
    }>
): Promise<Map<number, GasCalorificValue[]>> {
    const daysByZone = new Map<number, string[]>();
    for (const {row, profile} of selections) {
        const day = gasDayFor(
            row.bucket,
            profile.timezone,
            profile.dayBoundary
        );
        const days = daysByZone.get(profile.pricingZoneId) ?? [];
        days.push(day);
        daysByZone.set(profile.pricingZoneId, days);
    }
    const result = new Map<number, GasCalorificValue[]>();
    await Promise.all(
        [...daysByZone.entries()].map(async ([pricingZoneId, days]) => {
            days.sort();
            result.set(
                pricingZoneId,
                await input.repo.resolveCalorificValues({
                    orgId: input.orgId,
                    pricingZoneId,
                    from: days[0],
                    to: days.at(-1)!
                })
            );
        })
    );
    return result;
}

function mergeDisclosure(
    disclosures: Map<number, GasConversionDisclosure>,
    next: GasConversionDisclosure
): void {
    const prior = disclosures.get(next.profileId);
    if (!prior) {
        disclosures.set(next.profileId, next);
        return;
    }
    const values = new Map(
        [...prior.calorificValues, ...next.calorificValues].map((value) => [
            `${value.gasDay}|${value.id}|${value.revision}`,
            value
        ])
    );
    disclosures.set(next.profileId, {
        ...prior,
        calorificValues: [...values.values()].sort((left, right) =>
            left.gasDay.localeCompare(right.gasDay)
        )
    });
}

function requiredConverted(
    values: ReadonlyMap<Energy15minCostRow, Energy15minCostRow>,
    row: Energy15minCostRow
): Energy15minCostRow {
    const value = values.get(row);
    if (value === undefined)
        throw unavailable(
            `Gas row ${pointBucketKey(row, 'consumption')} was not converted.`
        );
    return value;
}

function requiredLookup(
    values: ReadonlyMap<string, number>,
    key: string,
    storedValue: number,
    grain: string
): number {
    const value = values.get(key);
    if (value !== undefined) return value;
    if (Math.abs(storedValue) <= 1e-12) return 0;
    throw unavailable(
        `Gas ${grain} ${key} has recorded volume but no converted billed quantity.`
    );
}

function pointKey(device: number, channel: number): string {
    return `${device}|${channel}`;
}

function pointBucketKey(
    input: {
        device: number;
        channel: number;
        bucket: string;
    },
    direction: 'consumption' | 'returned'
): string {
    return `${input.device}|${input.channel}|${new Date(input.bucket).getTime()}|${direction}`;
}

function displayDirectionKey(
    bucket: string,
    granularity: string,
    device: number,
    direction: 'consumption' | 'returned'
): string {
    return `${displayBucketKey(bucket, granularity, device)}|${direction}`;
}

function unavailable(message: string): RpcError {
    return RpcError.Domain('ValidationFailed', {
        message,
        field: 'gasConversion'
    });
}

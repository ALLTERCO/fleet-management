import RpcError from '../../rpc/RpcError';
import type {TariffBilledUnit} from '../../types/api/tariff';
import {dateInZone, hourInZone} from './localTimeInZone';

export type GasMeteredUnit = 'm3' | 'ft3' | 'ccf';
export type GasBilledUnit = Extract<
    TariffBilledUnit,
    'kWh' | 'therm' | 'MMBtu' | 'GJ'
>;
export interface GasConversionProfile {
    id: number;
    pricingZoneId: number;
    meteredUnit: GasMeteredUnit;
    billedUnit: GasBilledUnit;
    volumeState: 'corrected' | 'uncorrected';
    correctionMode:
        | 'none'
        | 'statutory_constant'
        | 'altitude_formula'
        | 'zone_table'
        | 'computed_PZ'
        | 'computed_TPZ';
    correctionFactor: number | null;
    metricFactor: number | null;
    /** MJ in one billed unit; explicit profile data, never inferred. */
    energyDivisor: number;
    revision: number;
    timezone: string;
    dayBoundary: string;
    sourceReference: string;
    /** Local gas-day validity, with an exclusive upper bound. */
    effectiveFrom?: string;
    effectiveTo?: string | null;
}

export interface GasCalorificValue {
    id: number;
    gasDay: string;
    value: number;
    unit: 'MJ/m3' | 'kWh/m3';
    weighting: 'none' | 'quantity';
    roundingRule: 'none' | 'truncate_0_1';
    revision: number;
    publishedAt: string;
    sourceReference: string;
}

export interface GasVolumeRow {
    bucket: string;
    volume: number;
}

export interface GasConversionDisclosure {
    profileId: number;
    profileRevision: number;
    meteredUnit: GasMeteredUnit;
    billedUnit: GasBilledUnit;
    volumeState: 'corrected' | 'uncorrected';
    correctionMode: GasConversionProfile['correctionMode'];
    correctionFactor: number;
    metricFactor: number;
    energyDivisor: number;
    calorificValues: Array<{
        gasDay: string;
        id: number;
        revision: number;
        value: number;
        unit: GasCalorificValue['unit'];
        sourceReference: string;
    }>;
}

export function convertGasVolume(input: {
    profile: GasConversionProfile | null;
    calorificValues: readonly GasCalorificValue[];
    rows: readonly GasVolumeRow[];
}): {billedQuantity: number; disclosure: GasConversionDisclosure} {
    const profile = input.profile;
    if (!profile)
        throw unavailable(
            'No gas conversion profile covers this service point and period.'
        );
    const metricFactor =
        profile.meteredUnit === 'm3' ? 1 : profile.metricFactor;
    if (!(metricFactor && metricFactor > 0)) {
        throw unavailable(
            `Gas profile ${profile.id} has no explicit ${profile.meteredUnit}-to-m3 factor.`
        );
    }
    const correctionFactor =
        profile.volumeState === 'corrected' ? 1 : profile.correctionFactor;
    if (!(correctionFactor && correctionFactor > 0)) {
        throw unavailable(
            `Gas profile ${profile.id} marks volume uncorrected but has no correction factor.`
        );
    }
    if (!(profile.energyDivisor > 0)) {
        throw unavailable(`Gas profile ${profile.id} has no energy divisor.`);
    }
    const byDay = new Map(
        input.calorificValues.map((value) => [value.gasDay, value])
    );
    const used = new Map<string, GasCalorificValue>();
    let billedQuantity = 0;
    for (const row of input.rows) {
        if (!Number.isFinite(row.volume) || row.volume < 0) {
            throw unavailable('Gas volume must be finite and non-negative.');
        }
        const day = gasDayFor(
            row.bucket,
            profile.timezone,
            profile.dayBoundary
        );
        const cv = byDay.get(day);
        if (!cv) {
            throw unavailable(
                `No published calorific value covers gas day ${day} for zone ${profile.pricingZoneId}.`
            );
        }
        const roundedCv =
            cv.roundingRule === 'truncate_0_1'
                ? Math.trunc(cv.value * 10) / 10
                : cv.value;
        const mjPerM3 = cv.unit === 'MJ/m3' ? roundedCv : roundedCv * 3.6;
        billedQuantity +=
            (row.volume * metricFactor * correctionFactor * mjPerM3) /
            profile.energyDivisor;
        used.set(day, cv);
    }
    return {
        billedQuantity,
        disclosure: {
            profileId: profile.id,
            profileRevision: profile.revision,
            meteredUnit: profile.meteredUnit,
            billedUnit: profile.billedUnit,
            volumeState: profile.volumeState,
            correctionMode: profile.correctionMode,
            correctionFactor,
            metricFactor,
            energyDivisor: profile.energyDivisor,
            calorificValues: [...used.entries()]
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([gasDay, value]) => ({
                    gasDay,
                    id: value.id,
                    revision: value.revision,
                    value: value.value,
                    unit: value.unit,
                    sourceReference: value.sourceReference
                }))
        }
    };
}

export function gasDayFor(
    bucket: string,
    timezone: string,
    dayBoundary: string
): string {
    const at = new Date(bucket);
    if (!Number.isFinite(at.getTime()))
        throw unavailable(`Invalid gas bucket '${bucket}'.`);
    const local = dateInZone(at, timezone);
    const [hours, minutes] = dayBoundary.split(':').map(Number);
    if (
        !Number.isInteger(hours) ||
        !Number.isInteger(minutes) ||
        hours < 0 ||
        hours > 23 ||
        minutes < 0 ||
        minutes > 59
    ) {
        throw unavailable(`Invalid gas-day boundary '${dayBoundary}'.`);
    }
    const beforeBoundary = hourInZone(at, timezone) * 60 < hours * 60 + minutes;
    const calendar = new Date(Date.UTC(local.year, local.month - 1, local.day));
    if (beforeBoundary) calendar.setUTCDate(calendar.getUTCDate() - 1);
    return calendar.toISOString().slice(0, 10);
}

function unavailable(message: string): RpcError {
    return RpcError.Domain('ValidationFailed', {
        message,
        field: 'gasConversion'
    });
}

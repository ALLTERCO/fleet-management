// Gas conversion rules the browser is allowed to apply: what each editor sends,
// and the reason a form cannot be sent. Volume becomes energy in the backend, so
// nothing here multiplies a reading; these functions only shape and check the
// numbers that will be stored.

import type {DataColumn} from '@/components/core/DataList.vue';
import type {
    HostParams,
    HostResult
} from '@/shell/template-host/generated/contract';
import type {shelly_device_t} from '@/types';

export type GasView = 'zones' | 'profiles' | 'values';

export type GasZone = HostResult<'gasconversion.listzones'>['items'][number];
export type GasProfile =
    HostResult<'gasconversion.listprofiles'>['items'][number];
export type GasCalorificValue =
    HostResult<'gasconversion.listcalorificvalues'>['items'][number];

export type GasZoneInput = HostParams<'gasconversion.upsertzone'>;
export type GasProfileInput = HostParams<'gasconversion.upsertprofile'>;
export type GasCalorificValueInput =
    HostParams<'gasconversion.addcalorificvalue'>;

export type GasMeteredUnit = GasProfileInput['meteredUnit'];
export type GasBilledUnit = GasProfileInput['billedUnit'];

export interface GasRecordPage<T> {
    items: T[];
    nextBeforeId: number | null;
}

type GasWriteMethod =
    | 'gasconversion.upsertzone'
    | 'gasconversion.upsertprofile'
    | 'gasconversion.addcalorificvalue';

/** One editor submission: the write it asks for, the line to show when it
 *  lands, and the reason it must not be sent at all. */
export interface GasSubmission {
    method: GasWriteMethod;
    input: GasZoneInput | GasProfileInput | GasCalorificValueInput;
    success: string;
    error: string | null;
}

/** What a form holds while it is being typed. */
export interface GasZoneDraft {
    name: string;
    zoneKind: string;
    externalCode: string;
    timezone: string;
    dayBoundary: string;
}

/** A number field stays a string here: an empty number input is an empty
 *  string, and reading it as zero would invent a factor nobody typed. */
export interface GasProfileDraft {
    deviceExternalId: string;
    channel: string | number;
    pricingZoneId: number;
    meteredUnit: GasMeteredUnit;
    billedUnit: GasBilledUnit;
    volumeState: GasProfileInput['volumeState'];
    correctionMode: GasProfileInput['correctionMode'];
    correctionFactor: string | number;
    metricFactor: string | number;
    energyDivisor: string | number;
    effectiveFrom: string;
    effectiveTo: string;
    sourceReference: string;
    revision: string | number;
}

export interface GasCalorificValueDraft {
    pricingZoneId: number;
    gasDay: string;
    value: string | number;
    unit: GasCalorificValueInput['unit'];
    weighting: GasCalorificValueInput['weighting'];
    roundingRule: GasCalorificValueInput['roundingRule'];
    revision: string | number;
    publishedAt: string;
    sourceReference: string;
}

// Physical definitions of the units themselves, not settings anyone may tune:
// one billed unit is this many megajoules, and the backend divides by it.
export const MJ_PER_BILLED_UNIT: Record<GasBilledUnit, number> = {
    kWh: 3.6,
    therm: 105.505,
    MMBtu: 1055.06,
    GJ: 1000
};

// Physical definitions too: one metered unit is this many cubic metres. A m³
// meter needs no conversion, so it has no entry.
export const M3_PER_METERED_UNIT: Record<
    Exclude<GasMeteredUnit, 'm3'>,
    number
> = {
    ft3: 0.0283168,
    ccf: 2.83168
};

// A supplier may publish the same figure rounded; further off is a different
// number and worth a second look before it reaches a bill.
const OVERRIDE_WARNING_TOLERANCE = 0.01;

export const GAS_TABS: ReadonlyArray<{value: GasView; label: string}> = [
    {value: 'zones', label: 'Pricing zones'},
    {value: 'profiles', label: 'Conversion profiles'},
    {value: 'values', label: 'Calorific values'}
];

export const GAS_ADD_LABELS: Record<GasView, string> = {
    zones: 'pricing zone',
    profiles: 'profile revision',
    values: 'calorific value'
};

export const GAS_ZONE_COLUMNS: DataColumn<GasZone>[] = [
    {key: 'name', label: 'Zone', role: 'primary'},
    {key: 'code', label: 'External code', role: 'secondary'},
    {key: 'zoneKind', label: 'Kind', role: 'status'},
    {key: 'clock', label: 'Gas-day clock', role: 'meta'}
];

export const GAS_PROFILE_COLUMNS: DataColumn<GasProfile>[] = [
    {key: 'meter', label: 'Meter point', role: 'primary'},
    {key: 'units', label: 'Conversion', role: 'secondary'},
    {key: 'revision', label: 'Revision', role: 'status'},
    {key: 'period', label: 'Effective period', role: 'meta'}
];

export const GAS_VALUE_COLUMNS: DataColumn<GasCalorificValue>[] = [
    {key: 'day', label: 'Gas day', role: 'primary'},
    {key: 'value', label: 'Published value', role: 'secondary'},
    {key: 'revision', label: 'Revision', role: 'status'},
    {key: 'zone', label: 'Pricing zone', role: 'meta'},
    {key: 'sourceReference', label: 'Source', role: 'meta'}
];

const ZONE_KIND_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function blankZoneDraft(): GasZoneDraft {
    return {
        name: '',
        zoneKind: '',
        externalCode: '',
        timezone: '',
        dayBoundary: '06:00:00'
    };
}

export function blankProfileDraft(): GasProfileDraft {
    const meteredUnit: GasMeteredUnit = 'm3';
    const billedUnit: GasBilledUnit = 'kWh';
    return {
        deviceExternalId: '',
        channel: '',
        pricingZoneId: 0,
        meteredUnit,
        billedUnit,
        volumeState: 'corrected',
        correctionMode: 'none',
        correctionFactor: '',
        metricFactor: metricFactorFieldValue(meteredUnit),
        energyDivisor: derivedEnergyDivisor(billedUnit),
        effectiveFrom: '',
        effectiveTo: '',
        sourceReference: '',
        revision: ''
    };
}

/** Megajoules in one billed unit: the number the backend divides by. */
export function derivedEnergyDivisor(unit: GasBilledUnit): number {
    return MJ_PER_BILLED_UNIT[unit];
}

/** Cubic metres in one metered unit, or null when the meter reads m³. */
export function derivedMetricFactor(unit: GasMeteredUnit): number | null {
    return unit === 'm3' ? null : M3_PER_METERED_UNIT[unit];
}

/** What the conversion field holds: empty when the meter reads m³, because the
 *  backend refuses a factor on a m³ profile. */
export function metricFactorFieldValue(unit: GasMeteredUnit): number | '' {
    return derivedMetricFactor(unit) ?? '';
}

export function billedUnitDefinition(unit: GasBilledUnit): string {
    return `1 ${unit} = ${derivedEnergyDivisor(unit)} MJ. We use this to turn gas volume into the unit on your bill.`;
}

export function meteredUnitDefinition(unit: GasMeteredUnit): string {
    const m3 = derivedMetricFactor(unit);
    return m3 === null ? '' : `1 ${unit} = ${m3} m3.`;
}

export function energyDivisorWarning(draft: GasProfileDraft): string {
    const derived = derivedEnergyDivisor(draft.billedUnit);
    if (!differsFromDerived(draft.energyDivisor, derived)) return '';
    return `Billed unit is ${draft.billedUnit}, so the energy divisor is normally ${derived}. Check this with your supplier before saving.`;
}

export function metricFactorWarning(draft: GasProfileDraft): string {
    const derived = derivedMetricFactor(draft.meteredUnit);
    if (derived === null || !differsFromDerived(draft.metricFactor, derived))
        return '';
    return `Metered unit is ${draft.meteredUnit}, so the conversion to m3 is normally ${derived}. Check this with your supplier before saving.`;
}

export function blankCalorificValueDraft(): GasCalorificValueDraft {
    return {
        pricingZoneId: 0,
        gasDay: '',
        value: '',
        unit: 'MJ/m3',
        weighting: 'none',
        roundingRule: 'none',
        revision: 1,
        publishedAt: '',
        sourceReference: ''
    };
}

export function zoneSubmission(draft: GasZoneDraft): GasSubmission {
    const input = zoneInput(draft);
    return {
        method: 'gasconversion.upsertzone',
        input,
        success: 'Gas pricing zone saved',
        error: zoneInputError(input)
    };
}

export function profileSubmission(draft: GasProfileDraft): GasSubmission {
    const input = profileInput(draft);
    return {
        method: 'gasconversion.upsertprofile',
        input,
        success: 'Gas conversion profile saved',
        error: profileInputError(input)
    };
}

export function calorificValueSubmission(
    draft: GasCalorificValueDraft
): GasSubmission {
    const input = calorificValueInput(draft);
    return {
        method: 'gasconversion.addcalorificvalue',
        input,
        success: 'Calorific value revision saved',
        error: calorificValueInputError(input)
    };
}

export function gasZoneLabel(zones: readonly GasZone[], id: number): string {
    const zone = zones.find((item) => item.id === id);
    return zone ? `${zone.name} · ${zone.externalCode}` : `Zone ${id}`;
}

export function gasDeviceLabel(device: shelly_device_t): string {
    return String(device.info?.name || device.info?.model || 'Unnamed device');
}

function zoneInput(draft: GasZoneDraft): GasZoneInput {
    return {
        name: draft.name.trim(),
        zoneKind: draft.zoneKind,
        externalCode: draft.externalCode.trim(),
        timezone: draft.timezone.trim(),
        dayBoundary: draft.dayBoundary
    };
}

function zoneInputError(input: GasZoneInput): string | null {
    if (!input.name || !input.externalCode || !isValidTimezone(input.timezone))
        return 'Enter a name, external code, and valid IANA timezone.';
    if (!ZONE_KIND_PATTERN.test(input.zoneKind))
        return 'Zone kind may contain only letters, numbers, underscore, and hyphen.';
    return null;
}

function profileInput(draft: GasProfileDraft): GasProfileInput {
    return {
        deviceExternalId: draft.deviceExternalId.trim(),
        channel: draft.channel === '' ? null : Number(draft.channel),
        pricingZoneId: Number(draft.pricingZoneId),
        meteredUnit: draft.meteredUnit,
        billedUnit: draft.billedUnit,
        volumeState: draft.volumeState,
        correctionMode: draft.correctionMode,
        correctionFactor:
            draft.correctionFactor === ''
                ? null
                : Number(draft.correctionFactor),
        metricFactor:
            draft.metricFactor === '' ? null : Number(draft.metricFactor),
        energyDivisor: Number(draft.energyDivisor),
        effectiveFrom: draft.effectiveFrom,
        ...(draft.effectiveTo ? {effectiveTo: draft.effectiveTo} : {}),
        sourceReference: draft.sourceReference.trim(),
        ...(draft.revision ? {revision: Number(draft.revision)} : {})
    };
}

function profileInputError(input: GasProfileInput): string | null {
    if (
        !input.deviceExternalId ||
        input.pricingZoneId < 1 ||
        !input.effectiveFrom ||
        !input.sourceReference
    )
        return 'Complete the meter, zone, effective date, and source reference.';
    if (!Number.isFinite(input.energyDivisor) || input.energyDivisor <= 0)
        return 'Energy divisor must be greater than zero.';
    if (input.effectiveTo && input.effectiveTo <= input.effectiveFrom)
        return 'Effective to must be after effective from.';
    if (
        input.volumeState === 'corrected' &&
        (input.correctionMode !== 'none' || input.correctionFactor !== null)
    )
        return 'Already-corrected volume must use no correction mode or factor.';
    if (
        input.volumeState === 'uncorrected' &&
        (input.correctionMode === 'none' ||
            !Number.isFinite(input.correctionFactor) ||
            Number(input.correctionFactor) <= 0)
    )
        return 'Uncorrected volume requires an explicit correction mode and positive factor.';
    if (input.meteredUnit === 'm3' && input.metricFactor !== null)
        return 'm³ profiles must not set a conversion-to-m³ factor.';
    if (
        input.meteredUnit !== 'm3' &&
        (!Number.isFinite(input.metricFactor) ||
            Number(input.metricFactor) <= 0)
    )
        return 'ft³ and CCF profiles require a positive conversion-to-m³ factor.';
    return null;
}

function calorificValueInput(
    draft: GasCalorificValueDraft
): GasCalorificValueInput {
    return {
        pricingZoneId: Number(draft.pricingZoneId),
        gasDay: draft.gasDay,
        value: Number(draft.value),
        unit: draft.unit,
        weighting: draft.weighting,
        roundingRule: draft.roundingRule,
        revision: Number(draft.revision),
        publishedAt: draft.publishedAt
            ? new Date(draft.publishedAt).toISOString()
            : '',
        sourceReference: draft.sourceReference.trim()
    };
}

function calorificValueInputError(
    input: GasCalorificValueInput
): string | null {
    if (
        input.pricingZoneId < 1 ||
        !input.gasDay ||
        !Number.isFinite(input.value) ||
        input.value <= 0 ||
        !input.sourceReference ||
        !input.publishedAt
    )
        return 'Complete the zone, gas day, positive value, publication time, and source reference.';
    return null;
}

// An empty or non-positive entry is already refused by name, so it never warns.
function differsFromDerived(typed: string | number, derived: number): boolean {
    const value = Number(typed);
    if (!Number.isFinite(value) || value <= 0) return false;
    return Math.abs(value - derived) > derived * OVERRIDE_WARNING_TOLERANCE;
}

function isValidTimezone(value: string): boolean {
    try {
        new Intl.DateTimeFormat('en', {timeZone: value.trim()}).format();
        return true;
    } catch {
        return false;
    }
}

// Single entry point called by LocationComponent Create/Update. Validates
// the kind-fields payload against the per-kind schema, then enforces the
// option-set + ISO constraints that JSON-schema alone can't express.

import RpcError from '../../rpc/RpcError';
import {ValidationError, validateParams} from '../../rpc/validation';
import type {LocationKind} from '../../types/api/location';
import {type LocationGeoShape, validateGeoShape} from './geoShape';
import {
    isValidCountryCode,
    isValidCurrency,
    isValidRegionCode,
    isValidTimezone
} from './isoData';
import {descriptorFor, isValidParentage} from './kindDescriptors';
import {LOCATION_KIND_FIELD_SCHEMAS} from './kindSchemas';
import {
    type ExtensibleOptionSetKey,
    isValidEnumValue,
    isValidExtensibleValue
} from './optionSets';

export interface LocationKindFields {
    [key: string]: unknown;
}

/** Validate + normalize the per-kind field payload. Returns the validated
 *  object (unknown fields already rejected by additionalProperties). */
export function validateKindFields(
    kind: LocationKind,
    rawFields: unknown,
    parentKind: LocationKind | null,
    parentCountryCode: string | undefined
): LocationKindFields {
    assertParentage(kind, parentKind);
    const fields = validateAgainstSchema(kind, rawFields);
    assertIsoCodes(fields, parentCountryCode);
    assertOptionSets(fields);
    assertCoherence(fields);
    return fields;
}

function assertParentage(
    kind: LocationKind,
    parentKind: LocationKind | null
): void {
    if (isValidParentage(kind, parentKind)) return;
    throw RpcError.InvalidParams(
        `Location kind '${kind}' cannot have parent '${parentKind ?? 'root'}'`
    );
}

function validateAgainstSchema(
    kind: LocationKind,
    rawFields: unknown
): LocationKindFields {
    const schema = LOCATION_KIND_FIELD_SCHEMAS[kind];
    try {
        return validateParams<LocationKindFields>(rawFields ?? {}, schema);
    } catch (err) {
        // Re-throw schema failures as RpcError so callers see one error
        // contract regardless of which axis (schema / ISO / coherence) fired.
        if (err instanceof ValidationError) {
            throw RpcError.InvalidParams(err.message, [...err.failures]);
        }
        throw err;
    }
}

function assertIsoCodes(
    fields: LocationKindFields,
    parentCountryCode: string | undefined
): void {
    if (
        isString(fields.countryCode) &&
        !isValidCountryCode(fields.countryCode)
    ) {
        throw RpcError.InvalidParams(
            `countryCode '${fields.countryCode}' is not a valid ISO 3166-1 alpha-2 code`
        );
    }
    if (
        isString(fields.regionCode) &&
        !isValidRegionCode(fields.regionCode, parentCountryCode)
    ) {
        throw RpcError.InvalidParams(
            `regionCode '${fields.regionCode}' is not a valid ISO 3166-2 code${
                parentCountryCode ? ` under country '${parentCountryCode}'` : ''
            }`
        );
    }
    if (isString(fields.currency) && !isValidCurrency(fields.currency)) {
        throw RpcError.InvalidParams(
            `currency '${fields.currency}' is not a valid ISO 4217 code`
        );
    }
    if (isString(fields.timezone) && !isValidTimezone(fields.timezone)) {
        throw RpcError.InvalidParams(
            `timezone '${fields.timezone}' is not a valid IANA zone`
        );
    }
}

function assertOptionSets(fields: LocationKindFields): void {
    // Custom values allowed; unsafe chars not.
    assertExtensible(fields, 'siteType', 'siteType');
    assertExtensible(fields, 'buildingType', 'buildingType');
    assertExtensible(fields, 'roomType', 'roomType');
    assertExtensible(fields, 'operationalTier', 'operationalTier');
    assertExtensible(fields, 'accessProcedure', 'accessProcedure');
    assertExtensible(fields, 'regulatoryZone', 'regulatoryZone');
    assertExtensible(fields, 'energyCertification', 'energyCertification');
    assertExtensibleArray(fields, 'complianceTags', 'complianceTag');
}

function assertCoherence(fields: LocationKindFields): void {
    assertSetpointCoherent(fields.environmentalSetpoint);
    assertOperatingHoursCoherent(fields.operatingHours);
    assertGeoCoherent(fields.geo);
}

function assertGeoCoherent(geo: unknown): void {
    if (geo === null || geo === undefined) return;
    validateGeoShape(geo as LocationGeoShape);
}

// ---- helpers ---------------------------------------------------------------

function isString(v: unknown): v is string {
    return typeof v === 'string' && v.length > 0;
}

function assertExtensible(
    fields: LocationKindFields,
    key: string,
    setKey: ExtensibleOptionSetKey
): void {
    const v = fields[key];
    if (!isString(v)) return;
    if (!isValidExtensibleValue(setKey, v)) {
        throw RpcError.InvalidParams(
            `${key} '${v}' is not a valid ${setKey} value`
        );
    }
}

function assertExtensibleArray(
    fields: LocationKindFields,
    key: string,
    setKey: ExtensibleOptionSetKey
): void {
    const arr = fields[key];
    if (arr == null) return;
    if (!Array.isArray(arr)) {
        throw RpcError.InvalidParams(`${key} must be an array of strings`);
    }
    for (const v of arr) {
        if (typeof v !== 'string' || !isValidEnumValue(v)) {
            throw RpcError.InvalidParams(
                `${key} contains invalid value '${String(v)}'`
            );
        }
        if (!isValidExtensibleValue(setKey, v)) {
            throw RpcError.InvalidParams(
                `${key} value '${v}' is not a valid ${setKey}`
            );
        }
    }
}

function assertSetpointCoherent(sp: unknown): void {
    if (!sp || typeof sp !== 'object') return;
    const {tempMinC, tempMaxC, humidityMinPct, humidityMaxPct} = sp as Record<
        string,
        unknown
    >;
    if (
        typeof tempMinC === 'number' &&
        typeof tempMaxC === 'number' &&
        tempMinC > tempMaxC
    ) {
        throw RpcError.InvalidParams(
            'environmentalSetpoint.tempMinC must be ≤ tempMaxC'
        );
    }
    if (
        typeof humidityMinPct === 'number' &&
        typeof humidityMaxPct === 'number' &&
        humidityMinPct > humidityMaxPct
    ) {
        throw RpcError.InvalidParams(
            'environmentalSetpoint.humidityMinPct must be ≤ humidityMaxPct'
        );
    }
}

function assertOperatingHoursCoherent(hours: unknown): void {
    if (!hours || typeof hours !== 'object') return;
    const DAYS = [
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday'
    ] as const;
    for (const day of DAYS) {
        const w = (hours as Record<string, unknown>)[day];
        if (!w || typeof w !== 'object') continue;
        const {open, close, closed} = w as Record<string, unknown>;
        if (closed === true) continue;
        if (typeof open !== 'string' || typeof close !== 'string') continue;
        if (open >= close) {
            throw RpcError.InvalidParams(
                `operatingHours.${day}.open must be before close`
            );
        }
    }
}

/** Describe the inheritance resolution a frontend preview can reuse. */
export function inheritableFieldsFor(kind: LocationKind): readonly string[] {
    return descriptorFor(kind).inheritableFields;
}

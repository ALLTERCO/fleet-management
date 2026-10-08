import type {
    GasCalorificValue,
    GasConversionProfile
} from '../../model/report/gasConversion';
import type {DbCaller} from './TariffRepository';

export interface GasPricingZoneRecord {
    id: number;
    name: string;
    zoneKind: string;
    externalCode: string;
    timezone: string;
    dayBoundary: string;
}

export interface GasConversionProfileRecord {
    id: number;
    deviceExternalId: string;
    channel: number | null;
    pricingZoneId: number;
    meteredUnit: GasConversionProfile['meteredUnit'];
    billedUnit: GasConversionProfile['billedUnit'];
    volumeState: GasConversionProfile['volumeState'];
    correctionMode: GasConversionProfile['correctionMode'];
    correctionFactor: number | null;
    metricFactor: number | null;
    energyDivisor: number;
    effectiveFrom: string;
    effectiveTo: string | null;
    sourceReference: string;
    revision: number;
    createdAt: string;
}

export interface GasCalorificValueRecord extends GasCalorificValue {
    pricingZoneId: number;
    createdAt: string;
}

export interface GasConversionPage<T> {
    items: T[];
    nextBeforeId: number | null;
}

export class GasConversionRepository {
    constructor(private readonly callDb: DbCaller) {}

    async upsertZone(orgId: string, payload: unknown): Promise<number> {
        const result = await this.callDb(
            'organization.fn_gas_pricing_zone_upsert',
            {p_org: orgId, p_payload: payload}
        );
        return Number(Object.values(result!.rows[0] as object)[0]);
    }

    async upsertProfile(orgId: string, payload: unknown): Promise<number> {
        const result = await this.callDb(
            'organization.fn_gas_conversion_profile_upsert',
            {p_org: orgId, p_payload: payload}
        );
        return Number(Object.values(result!.rows[0] as object)[0]);
    }

    async addCalorificValue(orgId: string, payload: unknown): Promise<number> {
        const result = await this.callDb(
            'organization.fn_gas_calorific_value_add',
            {p_org: orgId, p_payload: payload}
        );
        return Number(Object.values(result!.rows[0] as object)[0]);
    }

    async listZones(input: {
        orgId: string;
        limit?: number;
        beforeId?: number;
    }): Promise<GasConversionPage<GasPricingZoneRecord>> {
        const limit = input.limit ?? 100;
        const result = await this.callDb(
            'organization.fn_gas_pricing_zone_list',
            {
                p_org: input.orgId,
                p_limit: limit + 1,
                p_before_id: input.beforeId ?? null
            }
        );
        return pageFromRows(result?.rows ?? [], limit, (raw) => {
            const row = raw as Record<string, unknown>;
            return {
                id: Number(row.id),
                name: String(row.name),
                zoneKind: String(row.zone_kind),
                externalCode: String(row.external_code),
                timezone: String(row.timezone),
                dayBoundary: String(row.day_boundary)
            };
        });
    }

    async listAdminProfiles(input: {
        orgId: string;
        deviceExternalId?: string;
        channel?: number;
        limit?: number;
        beforeId?: number;
    }): Promise<GasConversionPage<GasConversionProfileRecord>> {
        const limit = input.limit ?? 100;
        const result = await this.callDb(
            'organization.fn_gas_conversion_profile_admin_list',
            {
                p_org: input.orgId,
                p_device_external_id: input.deviceExternalId ?? null,
                p_channel: input.channel ?? null,
                p_limit: limit + 1,
                p_before_id: input.beforeId ?? null
            }
        );
        return pageFromRows(result?.rows ?? [], limit, adminProfileFromRow);
    }

    async listCalorificValues(input: {
        orgId: string;
        pricingZoneId?: number;
        gasDayFrom?: string;
        gasDayTo?: string;
        limit?: number;
        beforeId?: number;
    }): Promise<GasConversionPage<GasCalorificValueRecord>> {
        const limit = input.limit ?? 100;
        const result = await this.callDb(
            'organization.fn_gas_calorific_value_list',
            {
                p_org: input.orgId,
                p_pricing_zone_id: input.pricingZoneId ?? null,
                p_gas_day_from: input.gasDayFrom ?? null,
                p_gas_day_to: input.gasDayTo ?? null,
                p_limit: limit + 1,
                p_before_id: input.beforeId ?? null
            }
        );
        return pageFromRows(result?.rows ?? [], limit, calorificValueFromRow);
    }

    async resolveProfile(input: {
        orgId: string;
        deviceExternalId: string;
        channel: number | null;
        from: string;
        to: string;
    }): Promise<GasConversionProfile | null> {
        const result = await this.callDb(
            'organization.fn_gas_conversion_profile_resolve',
            {
                p_org: input.orgId,
                p_device_external_id: input.deviceExternalId,
                p_channel: input.channel,
                p_from: input.from,
                p_to: input.to
            }
        );
        const row = result?.rows?.[0] as Record<string, unknown> | undefined;
        if (!row) return null;
        return profileFromRow(row);
    }

    async listProfiles(input: {
        orgId: string;
        deviceExternalId: string;
        channel: number | null;
        from: string;
        to: string;
    }): Promise<GasConversionProfile[]> {
        const result = await this.callDb(
            'organization.fn_gas_conversion_profile_list',
            {
                p_org: input.orgId,
                p_device_external_id: input.deviceExternalId,
                p_channel: input.channel,
                p_from: input.from,
                p_to: input.to
            }
        );
        return (result?.rows ?? []).map((raw) => profileFromRow(raw));
    }

    async resolveCalorificValues(input: {
        orgId: string;
        pricingZoneId: number;
        from: string;
        to: string;
    }): Promise<GasCalorificValue[]> {
        const result = await this.callDb(
            'organization.fn_gas_calorific_value_resolve',
            {
                p_org: input.orgId,
                p_zone: input.pricingZoneId,
                p_from: input.from,
                p_to: input.to
            }
        );
        return (result?.rows ?? []).map((raw) => calorificValueFromRow(raw));
    }
}

function adminProfileFromRow(raw: unknown): GasConversionProfileRecord {
    const row = raw as Record<string, unknown>;
    return {
        id: Number(row.id),
        deviceExternalId: String(row.device_external_id),
        channel: nullableNumber(row.channel),
        pricingZoneId: Number(row.pricing_zone_id),
        meteredUnit: row.metered_unit as GasConversionProfile['meteredUnit'],
        billedUnit: row.billed_unit as GasConversionProfile['billedUnit'],
        volumeState: row.volume_state as GasConversionProfile['volumeState'],
        correctionMode:
            row.correction_mode as GasConversionProfile['correctionMode'],
        correctionFactor: nullableNumber(row.correction_factor),
        metricFactor: nullableNumber(row.metric_factor),
        energyDivisor: Number(row.energy_divisor),
        effectiveFrom: dateString(row.effective_from),
        effectiveTo:
            row.effective_to == null ? null : dateString(row.effective_to),
        sourceReference: String(row.source_reference),
        revision: Number(row.revision),
        createdAt: dateTimeString(row.created_at)
    };
}

function calorificValueFromRow(raw: unknown): GasCalorificValueRecord {
    const row = raw as Record<string, unknown>;
    return {
        id: Number(row.id),
        pricingZoneId: Number(row.pricing_zone_id),
        gasDay: dateString(row.gas_day),
        value: Number(row.value),
        unit: row.unit as GasCalorificValue['unit'],
        weighting: row.weighting as GasCalorificValue['weighting'],
        roundingRule: row.rounding_rule as GasCalorificValue['roundingRule'],
        revision: Number(row.revision),
        publishedAt: dateTimeString(row.published_at),
        sourceReference: String(row.source_reference),
        createdAt: dateTimeString(row.created_at)
    };
}

function pageFromRows<T>(
    rows: unknown[],
    limit: number,
    map: (raw: unknown) => T
): GasConversionPage<T> {
    const hasNext = rows.length > limit;
    const items = rows.slice(0, limit).map(map);
    const last = items.at(-1) as {id?: number} | undefined;
    return {
        items,
        nextBeforeId: hasNext && last?.id ? last.id : null
    };
}

function profileFromRow(raw: unknown): GasConversionProfile {
    const row = raw as Record<string, unknown>;
    return {
        id: Number(row.id),
        pricingZoneId: Number(row.pricing_zone_id),
        meteredUnit: row.metered_unit as GasConversionProfile['meteredUnit'],
        billedUnit: row.billed_unit as GasConversionProfile['billedUnit'],
        volumeState: row.volume_state as GasConversionProfile['volumeState'],
        correctionMode:
            row.correction_mode as GasConversionProfile['correctionMode'],
        correctionFactor: nullableNumber(row.correction_factor),
        metricFactor: nullableNumber(row.metric_factor),
        energyDivisor: Number(row.energy_divisor),
        revision: Number(row.revision),
        timezone: String(row.timezone),
        dayBoundary: String(row.day_boundary),
        sourceReference: String(row.source_reference),
        effectiveFrom: dateString(row.effective_from),
        effectiveTo:
            row.effective_to == null ? null : dateString(row.effective_to)
    };
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

// The gas reads return dates as text (20160); a Date here would carry a time zone.
function dateString(value: unknown): string {
    if (typeof value === 'string' && CALENDAR_DATE.test(value)) return value;
    throw new Error(
        `Expected a YYYY-MM-DD calendar date, got ${String(value)}`
    );
}

function dateTimeString(value: unknown): string {
    return value instanceof Date ? value.toISOString() : String(value);
}

function nullableNumber(value: unknown): number | null {
    return value == null ? null : Number(value);
}

let defaultInstance: Promise<GasConversionRepository> | undefined;
export function defaultGasConversionRepository(): Promise<GasConversionRepository> {
    if (!defaultInstance) {
        defaultInstance = import('../PostgresProvider.js').then(
            (provider) =>
                new GasConversionRepository(provider.callMethod as DbCaller)
        );
    }
    return defaultInstance;
}

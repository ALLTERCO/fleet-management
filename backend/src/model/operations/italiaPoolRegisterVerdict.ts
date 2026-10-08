import {
    ITALIA_POOL_REGISTER_ENTRY_IDS,
    type ItaliaPoolChemistryBand,
    type ItaliaPoolChemistryPolicy,
    type ItaliaPoolRegisterEntryId,
    type ItaliaPoolRegisterEntryVerdict,
    type ItaliaPoolRegisterVerdict
} from '../../types/api/operations';

export interface ItaliaPoolRegisterReading {
    readonly entry: ItaliaPoolRegisterEntryId;
    readonly value: number | string;
    readonly source: 'measured' | 'entered';
    readonly acceptedAt: string | null;
    readonly acceptedBy: string | null;
}

const MEASURED_ENTRIES = new Set<ItaliaPoolRegisterEntryId>([
    'temperature',
    'makeUpWaterMeter'
]);

export function evaluateItaliaPoolRegister(
    policy: ItaliaPoolChemistryPolicy | null,
    date: string,
    readings: readonly ItaliaPoolRegisterReading[],
    identity: {poolId: string; siteId: number}
): ItaliaPoolRegisterVerdict {
    if (!policy) {
        return {
            poolId: identity.poolId,
            siteId: identity.siteId,
            date,
            status: 'config_missing',
            poolOpen: null,
            complete: false,
            presentCount: 0,
            requiredCount: 0,
            entries: []
        };
    }

    const poolOpen = dateWithinSeason(
        date,
        policy.seasonOpenMonthDay,
        policy.seasonCloseMonthDay
    );
    if (!poolOpen) {
        return {
            poolId: policy.poolId,
            siteId: policy.siteId,
            date,
            status: 'configured',
            poolOpen,
            complete: true,
            presentCount: 0,
            requiredCount: 0,
            entries: []
        };
    }

    const latest = new Map<
        ItaliaPoolRegisterEntryId,
        ItaliaPoolRegisterReading
    >();
    for (const reading of readings) {
        if (
            reading.source === 'measured' &&
            !MEASURED_ENTRIES.has(reading.entry)
        ) {
            throw new Error(
                `Italia pool register cannot measure ${reading.entry}`
            );
        }
        const current = latest.get(reading.entry);
        if (!current || reading.source === 'measured')
            latest.set(reading.entry, reading);
    }
    const bands = new Map<ItaliaPoolRegisterEntryId, ItaliaPoolChemistryBand>(
        policy.bands.map((band) => [band.entry, band])
    );
    const entries = ITALIA_POOL_REGISTER_ENTRY_IDS.map((entry) =>
        entryVerdict(entry, latest.get(entry), bands.get(entry) ?? null)
    );
    const presentCount = entries.filter(
        (entry) => entry.status === 'present'
    ).length;
    return {
        poolId: policy.poolId,
        siteId: policy.siteId,
        date,
        status: 'configured',
        poolOpen,
        complete: presentCount === entries.length,
        presentCount,
        requiredCount: entries.length,
        entries
    };
}

function entryVerdict(
    entry: ItaliaPoolRegisterEntryId,
    reading: ItaliaPoolRegisterReading | undefined,
    band: ItaliaPoolChemistryBand | null
): ItaliaPoolRegisterEntryVerdict {
    if (!reading) {
        return {
            entry,
            status: 'owed',
            source: MEASURED_ENTRIES.has(entry) ? 'measured' : 'entered',
            value: null,
            band,
            compliance: null,
            acceptedWrite: null
        };
    }
    return {
        entry,
        status: 'present',
        source: reading.source,
        value: reading.value,
        band,
        compliance:
            band && typeof reading.value === 'number'
                ? compliance(reading.value, band)
                : null,
        acceptedWrite:
            reading.source === 'entered' && reading.acceptedAt
                ? {at: reading.acceptedAt, username: reading.acceptedBy}
                : null
    };
}

function compliance(
    value: number,
    band: ItaliaPoolChemistryBand
): 'within' | 'below' | 'above' {
    if (band.min !== null && value < band.min) return 'below';
    if (band.max !== null && value > band.max) return 'above';
    return 'within';
}

function dateWithinSeason(date: string, open: string, close: string): boolean {
    const monthDay = date.slice(5);
    return monthDay >= open && monthDay <= close;
}

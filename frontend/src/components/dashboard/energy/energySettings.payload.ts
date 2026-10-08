// One place that turns the settings form into the dashboard.setsettings payload.
// Pure + typed so the mapping to the backend contract is unit-testable and lives
// in exactly one spot. TOU windows / weekend / holidays clear to null off TOU mode,
// and empty device lists send null (the contract's "all in scope" sentinel).
// refreshInterval never flows through this form — the auto-refresh cadence is
// owned by the shell ⋮ menu (DashViewActions), and a second sender would desync.
import type {DashboardSettings, PvMeterRef, TouWindow} from '@/types/dashboard';

export interface EnergySettingsForm {
    scopeType: 'fleet' | 'group';
    groupId: number | null;
    tariffId: number | null;
    tariffMode: 'single' | 'day_night' | 'tou';
    tariff: number;
    dayRate: number;
    nightRate: number;
    dayStart: string; // HH:MM
    dayEnd: string; // HH:MM
    currency: string;
    tariffTimezone: string; // '' => null
    tariffWindows: TouWindow[];
    weekendEnabled: boolean;
    weekendWindows: TouWindow[];
    holidaysText: string; // free text; YYYY-MM-DD tokens are kept
    defaultRange: string;
    emissionFactor: number | null;
    emissionFactorMbm: number | null;
    co2Budget: number | null;
    pvMode: string; // '' => null
    feedInRate: number;
    // Extra bill charges (drive the dashboard bill card + report).
    demandRate: number;
    standingCharge: number;
    standingPeriod: 'day' | 'month';
    vatPct: number;
    billingDay: number;
    // Nominal grid voltage / frequency — the EN 50160 power-quality band.
    nominalVoltage: number;
    nominalHz: number;
    mainMeterIds: string[];
    peakDeviceIds: string[];
    pvGridIds: string[];
    pvGenIds: string[];
}

const numOrNull = (n: number | null) =>
    typeof n === 'number' && Number.isFinite(n) ? n : null;
const nullIfEmpty = <T>(arr: T[]): T[] | null => (arr.length ? arr : null);
const toRefs = (ids: string[]): PvMeterRef[] =>
    ids.map((device) => ({device, channel: null}));

/** Keep only unique, well-formed YYYY-MM-DD tokens from free text. */
export function parseHolidays(text: string): string[] {
    const seen = new Set<string>();
    for (const token of text.split(/[\s,]+/)) {
        const t = token.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(t)) seen.add(t);
    }
    return [...seen];
}

/** Form → dashboard.setsettings payload. Only persisted contract fields. */
export function toSettingsPayload(
    form: EnergySettingsForm,
    chartSettings: Record<string, unknown>
): Partial<DashboardSettings & {groupId: number | null}> {
    return {
        groupId: form.scopeType === 'group' ? form.groupId : null,
        defaultRange: form.defaultRange,
        emissionFactorGPerKWh: numOrNull(form.emissionFactor),
        emissionFactorMbmGPerKWh: numOrNull(form.emissionFactorMbm),
        co2BudgetKg: numOrNull(form.co2Budget),
        peakDeviceIds: nullIfEmpty(form.peakDeviceIds),
        pvMode:
            form.pvMode === ''
                ? null
                : (form.pvMode as 'parallel' | 'backup' | 'balcony'),
        pvGridRefs: nullIfEmpty(toRefs(form.pvGridIds)),
        pvGenerationRefs: nullIfEmpty(toRefs(form.pvGenIds)),
        chartSettings: {
            ...chartSettings,
            mainMeterIds: form.mainMeterIds,
            nominalVoltage: form.nominalVoltage,
            nominalHz: form.nominalHz
        }
    };
}

// Strip-on-persist: only the fields the active tariff mode uses reach disk.
// Keeps storage honest — no stale tariff_windows lingering on a 'single' row.

import type {TariffMode, TariffWindow} from '../../types/api/dashboard';

export interface StripInput {
    tariffMode: TariffMode;
    tariffWindows: TariffWindow[] | null | undefined;
    tariffWeekendOverride: TariffWindow[] | null | undefined;
    tariffHolidays: string[] | null | undefined;
}

export interface StrippedTariff {
    tariffWindows: TariffWindow[] | null;
    tariffWeekendOverride: TariffWindow[] | null;
    tariffHolidays: string[] | null;
}

export function stripIgnoredTariffFields(input: StripInput): StrippedTariff {
    if (input.tariffMode === 'single') return allNull();
    return {
        tariffWindows:
            input.tariffMode === 'tou' ? (input.tariffWindows ?? null) : null,
        tariffWeekendOverride: input.tariffWeekendOverride ?? null,
        tariffHolidays: input.tariffHolidays ?? null
    };
}

function allNull(): StrippedTariff {
    return {
        tariffWindows: null,
        tariffWeekendOverride: null,
        tariffHolidays: null
    };
}

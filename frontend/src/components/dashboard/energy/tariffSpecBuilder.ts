// Extracted from EnergySettingsModal — pure form → TariffSpec conversion.
// Imported by the modal and unit-tested independently.

import type {TariffSeasonSpec, TariffSpec, TariffWindowSpec} from '@api/tariff';

export interface TariffEditorState {
    name: string;
    currency: string;
    timezone: string;
    billingDay: number;
    kind: 'single' | 'day_night' | 'tou' | 'live';
    rate: number;
    dayRate: number;
    nightRate: number;
    dayStart: string;
    dayEnd: string;
    standingCharge: number;
    standingChargePeriod: 'day' | 'month';
    vatPct: number | null;
    demandRate: number | null;
    seasons: TariffSeasonSpec[];
    liveMode: 'push' | 'pull';
    liveProvider: string;
    liveToken: string;
    liveArea: string;
}

export function emptyWindow(): TariffWindowSpec {
    return {daysMask: 127, startTime: '00:00', endTime: '00:00', price: 0};
}

export function emptySeason(): TariffSeasonSpec {
    return {
        startMonthDay: '01-01',
        endMonthDay: '12-31',
        windows: [emptyWindow()]
    };
}

export function buildSeasons(editor: TariffEditorState): TariffSeasonSpec[] {
    if (editor.kind === 'tou') return editor.seasons;
    if (editor.kind === 'live') return [];

    // For single / day_night: first season gets canonical windows.
    // Extra seasons (advanced override) keep their own windows.
    const extra = editor.seasons.slice(1);
    const firstStart = editor.seasons[0]?.startMonthDay ?? '01-01';
    const firstEnd = editor.seasons[0]?.endMonthDay ?? '12-31';

    const firstWindows: TariffWindowSpec[] =
        editor.kind === 'single'
            ? [
                  {
                      daysMask: 127,
                      startTime: '00:00',
                      endTime: '00:00',
                      price: editor.rate
                  }
              ]
            : [
                  {
                      daysMask: 127,
                      startTime: editor.dayStart,
                      endTime: editor.dayEnd,
                      price: editor.dayRate
                  },
                  {
                      daysMask: 127,
                      startTime: editor.dayEnd,
                      endTime: editor.dayStart,
                      price: editor.nightRate
                  }
              ];

    return [
        {
            startMonthDay: firstStart,
            endMonthDay: firstEnd,
            windows: firstWindows
        },
        ...extra
    ];
}

export function buildTariffSpec(
    editor: TariffEditorState,
    editingId: number | null = null
): TariffSpec {
    return {
        id: editingId ?? undefined,
        name: editor.name.trim(),
        currency: editor.currency,
        timezone: editor.timezone || 'UTC',
        billingDay: editor.billingDay,
        kind: editor.kind,
        standingCharge: editor.standingCharge,
        standingChargePeriod: editor.standingChargePeriod,
        vatPct: editor.vatPct,
        demandRate: editor.demandRate,
        seasons: buildSeasons(editor)
    };
}

export function defaultEditor(
    overrides: Partial<TariffEditorState> = {}
): TariffEditorState {
    return {
        name: '',
        currency: 'EUR',
        timezone: 'UTC',
        billingDay: 1,
        kind: 'single',
        rate: 0,
        dayRate: 0,
        nightRate: 0,
        dayStart: '07:00',
        dayEnd: '23:00',
        standingCharge: 0,
        standingChargePeriod: 'month',
        vatPct: null,
        demandRate: null,
        seasons: [emptySeason()],
        liveMode: 'push',
        liveProvider: 'entsoe',
        liveToken: '',
        liveArea: '',
        ...overrides
    };
}

import {describe, expect, it} from 'vitest';
import {parseHolidays, toSettingsPayload, type EnergySettingsForm} from '@/components/dashboard/energy/energySettings.payload';

function form(overrides: Partial<EnergySettingsForm> = {}): EnergySettingsForm {
    return {
        scopeType: 'group',
        groupId: 7,
        tariffId: null,
        tariffMode: 'single',
        tariff: 0.3,
        dayRate: 0.28,
        nightRate: 0.16,
        dayStart: '07:00',
        dayEnd: '23:00',
        currency: 'EUR',
        tariffTimezone: '',
        tariffWindows: [],
        weekendEnabled: false,
        weekendWindows: [],
        holidaysText: '',
        defaultRange: 'last_7_days',
        refreshInterval: 60000,
        emissionFactor: 414,
        emissionFactorMbm: null,
        co2Budget: null,
        pvMode: '',
        feedInRate: 0.1,
        demandRate: 0,
        standingCharge: 0,
        standingPeriod: 'month',
        vatPct: 0,
        billingDay: 1,
        nominalVoltage: 230,
        nominalHz: 50,
        mainMeterIds: [],
        peakDeviceIds: [],
        pvGridIds: [],
        pvGenIds: [],
        ...overrides
    };
}

describe('toSettingsPayload', () => {
    it('nulls groupId in fleet scope, keeps it in group scope', () => {
        expect(toSettingsPayload(form({scopeType: 'fleet'}), {}).groupId).toBeNull();
        expect(toSettingsPayload(form({scopeType: 'group', groupId: 7}), {}).groupId).toBe(7);
    });

    it('appends seconds to day window times', () => {
        const p = toSettingsPayload(form(), {});
        expect(p.dayStart).toBe('07:00:00');
        expect(p.dayEnd).toBe('23:00:00');
    });

    it('sends TOU windows only in tou mode, else null', () => {
        const windows = [{from: '07:00', to: '22:00', rate: 0.3, label: 'Peak'}];
        expect(toSettingsPayload(form({tariffMode: 'single', tariffWindows: windows}), {}).tariffWindows).toBeNull();
        expect(toSettingsPayload(form({tariffMode: 'tou', tariffWindows: windows}), {}).tariffWindows).toEqual(windows);
    });

    it('sends null (never an empty array) for TOU windows with no rows — respects minItems', () => {
        expect(toSettingsPayload(form({tariffMode: 'tou', tariffWindows: []}), {}).tariffWindows).toBeNull();
    });

    it('sends the weekend override only when enabled and populated in tou mode', () => {
        const wk = [{from: '00:00', to: '24:00', rate: 0.2, label: 'Weekend'}];
        expect(toSettingsPayload(form({tariffMode: 'tou', weekendEnabled: false, weekendWindows: wk}), {}).tariffWeekendOverride).toBeNull();
        expect(toSettingsPayload(form({tariffMode: 'tou', weekendEnabled: true, weekendWindows: wk}), {}).tariffWeekendOverride).toEqual(wk);
    });

    it('clears holidays unless TOU mode is active', () => {
        const text = '2026-01-01 2026-12-25';
        expect(toSettingsPayload(form({tariffMode: 'single', holidaysText: text}), {}).tariffHolidays).toBeNull();
        expect(toSettingsPayload(form({tariffMode: 'tou', holidaysText: text}), {}).tariffHolidays).toEqual(['2026-01-01', '2026-12-25']);
    });

    it('converts device id lists to PV meter refs with a null channel, null when empty', () => {
        const p = toSettingsPayload(form({pvGridIds: ['shellyA', 'shellyB'], pvGenIds: []}), {});
        expect(p.pvGridRefs).toEqual([{device: 'shellyA', channel: null}, {device: 'shellyB', channel: null}]);
        expect(p.pvGenerationRefs).toBeNull();
    });

    it('sends peakDeviceIds when set, null when empty (all-in-scope sentinel)', () => {
        expect(toSettingsPayload(form({peakDeviceIds: []}), {}).peakDeviceIds).toBeNull();
        expect(toSettingsPayload(form({peakDeviceIds: ['x']}), {}).peakDeviceIds).toEqual(['x']);
    });

    it('nulls a blank timezone and trims a real one', () => {
        expect(toSettingsPayload(form({tariffTimezone: '  '}), {}).tariffTimezone).toBeNull();
        expect(toSettingsPayload(form({tariffTimezone: ' Europe/Sofia '}), {}).tariffTimezone).toBe('Europe/Sofia');
    });

    it('carries feed-in rate and main meters into chartSettings without dropping prior keys', () => {
        const cs = toSettingsPayload(form({feedInRate: 0.12, mainMeterIds: ['m1']}), {theme: 'dark'}).chartSettings;
        expect(cs).toMatchObject({theme: 'dark', feedInRate: 0.12, mainMeterIds: ['m1']});
    });

    it('keeps both emission factors as numbers or null', () => {
        const p = toSettingsPayload(form({emissionFactor: 414, emissionFactorMbm: 233}), {});
        expect(p.emissionFactorGPerKWh).toBe(414);
        expect(p.emissionFactorMbmGPerKWh).toBe(233);
        expect(toSettingsPayload(form({emissionFactorMbm: null}), {}).emissionFactorMbmGPerKWh).toBeNull();
    });
});

describe('parseHolidays', () => {
    it('keeps well-formed ISO dates and drops noise + duplicates', () => {
        expect(parseHolidays('2026-01-01, 2026-12-25\n2026-01-01 nonsense 5')).toEqual(['2026-01-01', '2026-12-25']);
    });
    it('returns an empty array for blank text', () => {
        expect(parseHolidays('   ')).toEqual([]);
    });
});

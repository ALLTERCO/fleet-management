import {describe, expect, it} from 'vitest';
import {buildEnergyDashboardData, type EnergyDashboardInputs} from '@/components/dashboard/energy/energyDashboard.mapper';
import {energyDashboardSample} from '@/components/dashboard/energy/energyDashboard.sample';
import {resolveEnergyDashboardView} from '@/components/dashboard/energy/energyDashboard.view';

function inputs(overrides: Partial<EnergyDashboardInputs> = {}): EnergyDashboardInputs {
    return {
        rangeLabel: 'Real range',
        deviceCount: 1,
        onlineCount: 1,
        currency: '€',
        tariffConfigured: false,
        hasGroups: false,
        hasKinds: false,
        hasSolar: false,
        totalConsumptionKwh: 12,
        totalCost: null,
        projectedCost: null,
        totalReturnedKwh: 0,
        rangeDays: 1,
        priorConsumptionKwh: null,
        priorCost: null,
        consumption: [],
        returned: [],
        dayKwh: 0,
        nightKwh: 0,
        dayRate: 0,
        nightRate: 0,
        demandRate: 0,
        standingCharge: 0,
        standingPeriod: 'month',
        vatPct: 0,
        avgVoltage: null,
        avgPowerFactor: null,
        avgFrequency: null,
        peakKw: 0,
        livePowerKw: 0,
        powerSeriesKw: [],
        phases: [],
        voltageMin: null,
        voltageMax: null,
        pfMin: null,
        pfMax: null,
        freqMin: null,
        freqMax: null,
        voltageEventCount: 0,
        consumers: [],
        locations: [],
        meters: [],
        hourly: [],
        co2LocationKg: 0,
        co2AvoidedKg: 0,
        co2BudgetKg: null,
        emissionFactorMbm: null,
        pvGenerationKwh: 0,
        pvMode: '',
        hasBattery: false,
        batteryChargedKwh: 0,
        batteryDischargedKwh: 0,
        hasEv: false,
        evDeliveredKwh: 0,
        hourlyWeekday: [],
        hourlyWeekend: [],
        envTemp: null,
        envHumidity: null,
        envLuminance: null,
        envFlow: null,
        tenants: [],
        byKind: [],
        utility: [],
        weekdayKwh: 0,
        weekendKwh: 0,
        weekdayDays: 0,
        weekendDays: 0,
        ...overrides,
    };
}

describe('resolveEnergyDashboardView', () => {
    it('uses the sample only when no real dashboard data exists', () => {
        expect(resolveEnergyDashboardView(null).meta.rangeLabel).toBe(energyDashboardSample().meta.rangeLabel);
    });

    it('does not merge demo numbers into real dashboard data', () => {
        const real = buildEnergyDashboardData(inputs());
        const view = resolveEnergyDashboardView(real);
        expect(view).toBe(real);
        expect(view.meta.rangeLabel).toBe('Real range');
        expect(view.overview.consumptionKwh).toBe(12);
        expect(view.devices.consumers).toEqual([]);
    });
});

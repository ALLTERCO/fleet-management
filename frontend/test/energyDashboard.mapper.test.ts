import {describe, expect, it} from 'vitest';
import {buildEnergyDashboardData, type EnergyDashboardInputs} from '@/components/dashboard/energy/energyDashboard.mapper';

function inputs(overrides: Partial<EnergyDashboardInputs> = {}): EnergyDashboardInputs {
    return {
        rangeLabel: 'Jun 1 – Jun 30, 2026',
        deviceCount: 10,
        onlineCount: 8,
        currency: '€',
        tariffConfigured: true,
        hasGroups: true,
        hasKinds: false,
        hasSolar: false,
        totalConsumptionKwh: 1000,
        totalCost: 200,
        projectedCost: 240,
        totalReturnedKwh: 100,
        rangeDays: 30,
        priorConsumptionKwh: null,
        priorCost: null,
        consumption: [{bucket: '2026-06-01T00:00:00Z', value: 40}],
        returned: [{bucket: '2026-06-01T00:00:00Z', value: 5}],
        dayKwh: 600,
        nightKwh: 400,
        dayRate: 0.28,
        nightRate: 0.16,
        demandRate: 0,
        standingCharge: 0,
        standingPeriod: 'month',
        vatPct: 0,
        avgVoltage: 231,
        avgPowerFactor: 0.94,
        avgFrequency: 50,
        peakKw: 8,
        livePowerKw: 2.4,
        powerSeriesKw: [{bucket: 'a', value: 3}, {bucket: 'b', value: 1}, {bucket: 'c', value: 5}],
        phases: [],
        voltageMin: null,
        voltageMax: null,
        pfMin: null,
        pfMax: null,
        freqMin: null,
        freqMax: null,
        voltageEventCount: 0,
        consumers: [{id: 1, name: 'HVAC', online: true, consumption: 500.4, power: 1420.6, share: 41.2}],
        locations: [{name: 'Roof', totalKwh: 526}],
        meters: [],
        hourly: [0.4, 0.5],
        co2LocationKg: 300,
        co2AvoidedKg: 120,
        co2BudgetKg: 3400,
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

describe('buildEnergyDashboardData', () => {
    it('nulls cost + projection when no tariff is configured', () => {
        const d = buildEnergyDashboardData(inputs({tariffConfigured: false}));
        expect(d.overview.costValue).toBeNull();
        expect(d.overview.projectedValue).toBeNull();
        expect(d.overview.bill.total).toBe(0);
    });

    it('keeps real cost when a tariff is configured', () => {
        const d = buildEnergyDashboardData(inputs());
        expect(d.overview.costValue).toBe(200);
        expect(d.overview.projectedValue).toBe(240);
    });

    it('splits TOU cost by day/night rate, not by kWh', () => {
        const d = buildEnergyDashboardData(inputs());
        // day 600*0.28=168, night 400*0.16=64 → total 232, dayPct ≈ 72.4%
        expect(d.overview.tou.dayCost).toBeCloseTo(168);
        expect(d.overview.tou.nightCost).toBeCloseTo(64);
        expect(d.overview.tou.dayPct).toBeCloseTo((168 / 232) * 100);
    });

    it('derives data quality from the reporting ratio', () => {
        const d = buildEnergyDashboardData(inputs({deviceCount: 10, onlineCount: 5}));
        expect(d.overview.dataQualityPct).toBe(50);
    });

    it('builds the load-duration curve sorted high→low from the power series', () => {
        const d = buildEnergyDashboardData(inputs());
        expect(d.energy.loadDuration.map((p) => p.value)).toEqual([5, 3, 1]);
    });

    it('fails voltage quality when the average is outside the EN 50160 window', () => {
        expect(buildEnergyDashboardData(inputs({avgVoltage: 260})).overview.voltagePass).toBe(false);
        expect(buildEnergyDashboardData(inputs({avgVoltage: 231})).overview.voltagePass).toBe(true);
    });

    it('maps consumers with rounded live/consumption/share', () => {
        const [c] = buildEnergyDashboardData(inputs()).devices.consumers;
        expect(c).toMatchObject({name: 'HVAC', kwh: 500, liveW: 1421, sharePct: 41});
    });

    it('returns honest empties for fields with no live source', () => {
        const d = buildEnergyDashboardData(inputs());
        expect(d.energy.utility).toEqual([]);
        expect(d.devices.tenants).toEqual([]);
        expect(d.solar.battery).toBeNull();
    });

    it('keeps setup flags from explicit configuration even when the current window has no rows', () => {
        const d = buildEnergyDashboardData(inputs({hasKinds: true, byKind: []}));
        expect(d.config.kinds).toBe(true);
    });

    it('keeps solar disabled until a real solar, battery, EV, or PV signal is present', () => {
        expect(buildEnergyDashboardData(inputs({hasSolar: false})).config.solar).toBe(false);
        expect(buildEnergyDashboardData(inputs({hasSolar: true})).config.solar).toBe(true);
    });

    it('raises no anomalies when everything is within range', () => {
        const d = buildEnergyDashboardData(
            inputs({avgVoltage: 231, onlineCount: 10, deviceCount: 10, co2BudgetKg: 100000, consumers: [{id: 1, name: 'HVAC', online: true, consumption: 100, power: 400, share: 20}]})
        );
        expect(d.carbon.anomalies).toEqual([]);
    });

    it('flags low voltage, phase imbalance, a dominant load and budget overshoot as anomalies', () => {
        const phases = [
            {name: 'L1', watts: 1000, volts: 200, amps: 5, pct: 100},
            {name: 'L2', watts: 500, volts: 200, amps: 2.5, pct: 50},
            {name: 'L3', watts: 1000, volts: 200, amps: 5, pct: 100}
        ];
        const d = buildEnergyDashboardData(
            inputs({avgVoltage: 205, phases, co2LocationKg: 400, co2BudgetKg: 200})
        );
        const titles = d.carbon.anomalies.map((a) => a.title);
        expect(titles).toContain('Low supply voltage'); // 205 < 210
        expect(titles).toContain('Phase imbalance'); // L2 33% off
        expect(titles).toContain('One load dominates'); // HVAC 41.2%
        expect(titles).toContain('Over carbon budget'); // 200% used
    });

    it('recommends power-factor correction with the estimated uplift cost', () => {
        const d = buildEnergyDashboardData(inputs({avgPowerFactor: 0.8, totalCost: 300, totalConsumptionKwh: 1000}));
        const pf = d.carbon.recommendations.find((r) => r.title === 'Correct the power factor');
        expect(pf).toBeTruthy();
        // eff rate 0.3, uplift 0.9/0.8-1=0.125 → 1000×0.3×0.125 = 37.5
        expect(pf?.body).toContain('37.5');
    });

    it('recommends reconnecting offline devices past 10 % offline', () => {
        const d = buildEnergyDashboardData(inputs({deviceCount: 10, onlineCount: 8}));
        expect(d.carbon.recommendations.map((r) => r.title)).toContain('Reconnect offline devices');
    });

    it('computes signed period-over-period deltas, null without a baseline', () => {
        expect(buildEnergyDashboardData(inputs()).overview.consumptionDeltaPct).toBeNull();
        const d = buildEnergyDashboardData(inputs({totalConsumptionKwh: 1100, priorConsumptionKwh: 1000, totalCost: 220, priorCost: 200}));
        expect(d.overview.consumptionDeltaPct).toBe(10); // (1100-1000)/1000
        expect(d.overview.costDeltaPct).toBe(10); // (220-200)/200
    });

    it('nulls the cost delta when no tariff is configured', () => {
        const d = buildEnergyDashboardData(inputs({tariffConfigured: false, priorCost: 200}));
        expect(d.overview.costDeltaPct).toBeNull();
    });

    it('labels consumption points from the ISO bucket month/day', () => {
        const d = buildEnergyDashboardData(inputs());
        expect(d.overview.consumption[0].label).toBe('Jun 1');
    });

    it('captions live power with the online device count, blank when none', () => {
        expect(buildEnergyDashboardData(inputs({onlineCount: 8})).power.liveNote).toBe('8 online');
        expect(buildEnergyDashboardData(inputs({onlineCount: 0})).power.liveNote).toBe('');
    });

    it('derives always-on baseload from the smallest power bucket over the period', () => {
        // power series min = 1 kW = 1000 W, drawn over 30 days × 24 h = 720 kWh
        const d = buildEnergyDashboardData(inputs());
        expect(d.energy.alwaysOnW).toBe(1000);
        expect(d.overview.alwaysOnKwh).toBe(720);
    });

    it('derives apparent (kVAh) and reactive (kVARh) energy from active energy and PF', () => {
        // kWh 1000, PF 0.94 → apparent 1063.83, reactive √(apparent²−1000²)
        const d = buildEnergyDashboardData(inputs({avgPowerFactor: 0.94}));
        expect(d.power.apparentKvah).toBeCloseTo(1063.83, 1);
        expect(d.power.reactiveKvarh).toBeCloseTo(Math.sqrt(1063.83 ** 2 - 1000 ** 2), 0);
    });

    it('leaves reactive/apparent at zero when no power factor is known', () => {
        const d = buildEnergyDashboardData(inputs({avgPowerFactor: null}));
        expect(d.power.apparentKvah).toBe(0);
        expect(d.power.reactiveKvarh).toBe(0);
    });

    it('computes market-based carbon only when an MBM factor is set', () => {
        expect(buildEnergyDashboardData(inputs()).carbon.marketBasedKg).toBe(0);
        // 1000 kWh × 233 g/kWh = 233000 g = 233 kg
        expect(buildEnergyDashboardData(inputs({emissionFactorMbm: 233})).carbon.marketBasedKg).toBe(233);
    });

    it('reports carbon budget overshoot only past 100 % of budget', () => {
        expect(buildEnergyDashboardData(inputs({co2LocationKg: 300, co2BudgetKg: 3400})).carbon.overshootPct).toBe(0);
        const over = buildEnergyDashboardData(inputs({co2LocationKg: 400, co2BudgetKg: 200}));
        expect(over.carbon.overshootPct).toBe(100); // 200% used → 100% over
    });

    it('computes phase imbalance as the worst leg deviation from the 3-phase average', () => {
        const phases = [
            {name: 'L1', watts: 1000, volts: 230, amps: 4.3, pct: 100},
            {name: 'L2', watts: 700, volts: 230, amps: 3.0, pct: 70},
            {name: 'L3', watts: 1000, volts: 230, amps: 4.3, pct: 100},
        ];
        // avg 900; worst leg L2 dev = |700-900|/900 = 22.22%
        const d = buildEnergyDashboardData(inputs({phases}));
        expect(d.power.phaseImbalancePct).toBeCloseTo(22.22, 1);
        expect(d.power.phaseWorst).toBe('L2');
    });

    it('formats measurement ranges, blank when a bound is unknown', () => {
        const d = buildEnergyDashboardData(inputs({voltageMin: 228.4, voltageMax: 236.1, pfMin: 0.9, pfMax: 0.98}));
        expect(d.power.voltageRange).toBe('228.4–236.1 V');
        expect(d.power.powerFactorRange).toBe('0.90–0.98');
        expect(d.power.frequencyRange).toBe(''); // freq bounds still null
    });

    it('derives the PV energy balance (house = grid + generation − exported)', () => {
        // consumption 1000, returned 100 → gridImport 900; generation 400
        const d = buildEnergyDashboardData(inputs({pvGenerationKwh: 400, pvMode: 'parallel'}));
        expect(d.solar.pv.gridImport).toBe(900);
        expect(d.solar.pv.generation).toBe(400);
        expect(d.solar.pv.exported).toBe(100);
        expect(d.solar.pv.selfConsumed).toBe(300); // 400 − 100
        expect(d.solar.pv.house).toBe(1200); // 900 + 400 − 100
        expect(d.solar.pv.selfConsumptionPct).toBe(75); // 300/400
        expect(d.solar.pv.selfSufficiencyPct).toBe(25); // 300/1200
    });

    it('treats balcony PV as non-exporting', () => {
        const d = buildEnergyDashboardData(inputs({pvGenerationKwh: 400, pvMode: 'balcony'}));
        expect(d.solar.pv.exported).toBe(0);
        expect(d.solar.pv.selfConsumed).toBe(400);
    });

    it('derives battery round-trip and losses, null when no battery meter', () => {
        expect(buildEnergyDashboardData(inputs()).solar.battery).toBeNull();
        const d = buildEnergyDashboardData(inputs({hasBattery: true, batteryChargedKwh: 100, batteryDischargedKwh: 90}));
        expect(d.solar.battery).toMatchObject({charged: 100, discharged: 90, roundTripPct: 90, losses: 10});
    });

    it('counts EN 50160 voltage-band events from the input', () => {
        expect(buildEnergyDashboardData(inputs({voltageEventCount: 3})).power.en50160Events).toBe(3);
    });

    it('builds the full bill: energy + demand + standing, then VAT on the subtotal', () => {
        const d = buildEnergyDashboardData(
            inputs({totalCost: 200, peakKw: 8, rangeDays: 30, demandRate: 5, standingCharge: 10, standingPeriod: 'month', vatPct: 20})
        );
        // energy 200, demand 8×5×1mo=40, standing 10×1mo=10 → subtotal 250, VAT 50, total 300
        expect(d.overview.bill.demand).toBe(40);
        expect(d.overview.bill.standing).toBe(10);
        expect(d.overview.bill.vat).toBe(50);
        expect(d.overview.bill.total).toBe(300);
    });

    it('leaves demand/standing/VAT at zero when no extra charges are set', () => {
        const b = buildEnergyDashboardData(inputs({totalCost: 200})).overview.bill;
        expect(b.demand).toBe(0);
        expect(b.standing).toBe(0);
        expect(b.vat).toBe(0);
        expect(b.total).toBe(200);
    });

    it('splits the daily rhythm into weekday and weekend profiles', () => {
        const wd = new Array(24).fill(2);
        const we = new Array(24).fill(1);
        const d = buildEnergyDashboardData(inputs({hourlyWeekday: wd, hourlyWeekend: we}));
        expect(d.energy.rhythmWeekday).toHaveLength(24);
        expect(d.energy.rhythmWeekend[0]).toEqual({label: '00:00', value: 1});
    });

    it('formats the environment tile, — when a sensor is absent', () => {
        const d = buildEnergyDashboardData(inputs({envTemp: 21.4, envHumidity: 55, envLuminance: 300}));
        expect(d.energy.env).toMatchObject({temp: '21.4 °C', humidity: '55 %', luminance: '300 lx', flow: '—'});
    });

    it('computes the live-flow balance as average kW over the period', () => {
        // 720 h in 30 days; generation 720 → 1 kW solar, consumption 720 → 1 kW home
        const d = buildEnergyDashboardData(inputs({rangeDays: 30, pvGenerationKwh: 720, totalConsumptionKwh: 720, totalReturnedKwh: 0}));
        expect(d.solar.flow.solar).toBe(1);
        expect(d.solar.flow.home).toBe(1);
    });

    it('derives the load-shift opportunity only when the day rate beats the night rate', () => {
        const d = buildEnergyDashboardData(inputs({dayKwh: 600, dayRate: 0.3, nightRate: 0.1}));
        expect(d.overview.tou.shiftKwh).toBe(120); // 600 × 0.2
        expect(d.overview.tou.shiftSave).toBeCloseTo(24); // 120 × 0.2
        expect(buildEnergyDashboardData(inputs({dayRate: 0.1, nightRate: 0.3})).overview.tou.shiftKwh).toBe(0);
    });

    it('compares the bill against a flat peak-rate utility bill', () => {
        // 1000 kWh × 0.28 flat = 280; bill total = energy 200 → 28.6% cheaper
        const d = buildEnergyDashboardData(inputs({totalConsumptionKwh: 1000, totalCost: 200, dayRate: 0.28}));
        expect(d.overview.bill.vsUtility).toBe(280);
        expect(d.overview.bill.deltaPct).toBeCloseTo(-28.57, 1);
    });

    it('fills the EV card from delivered energy, null when no EV meter', () => {
        expect(buildEnergyDashboardData(inputs()).solar.ev).toBeNull();
        const d = buildEnergyDashboardData(inputs({hasEv: true, evDeliveredKwh: 50, totalCost: 200, totalConsumptionKwh: 1000}));
        expect(d.solar.ev).toMatchObject({delivered: 50, cost: 10}); // 50 × (200/1000)
    });

    it('passes through per-group tenant allocation rows', () => {
        const tenants = [{label: 'Floor 1', value: '500 kWh · €140'}];
        expect(buildEnergyDashboardData(inputs({tenants})).devices.tenants).toEqual(tenants);
    });
});

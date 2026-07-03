// Dev/preview fixture for the energy dashboard — the single home for sample data.
// Used only by the standalone preview (preview-main.ts); the shipped route always
// feeds real data via buildEnergyDashboardData. Kept out of the component so the
// component has one responsibility (presentation) and no embedded data.
import type {EnergyDashboardData, EnergyPoint} from './energyDashboard.types';

/** Deterministic pseudo-random sequence so the sample renders identically. */
function seeded(n: number): number[] {
    let s = 42;
    return Array.from({length: n}, () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
    });
}

function points(values: number[], label: (i: number) => string): EnergyPoint[] {
    return values.map((value, i) => ({label: label(i), value}));
}

export function energyDashboardSample(): EnergyDashboardData {
    const r = seeded(80);
    const consumption = Array.from({length: 30}, (_, i) => {
        const weekend = i % 7 === 5 || i % 7 === 6 ? 0.82 : 1;
        return 34 + weekend * (10 + 8 * Math.sin(i / 4.4) + r[i] * 9);
    });
    const returned = consumption.map((_, i) => 5 + 4.5 * Math.sin(i / 3 + 1) + r[i + 8] * 3);
    const projection = [consumption[29]];
    for (let i = 1; i <= 6; i++) projection.push(44 + 3 * Math.sin((29 + i) / 4.4) + 1.5);

    const dayLabel = (i: number) => `Jun ${i + 1}`;
    const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;
    const rhythmWeekday = Array.from({length: 24}, (_, h) => (h >= 7 && h <= 20 ? 1.7 + 1.35 * Math.sin(((h - 7) / 13) * Math.PI) : 0.42) + r[h] * 0.25);
    const rhythmWeekend = Array.from({length: 24}, (_, h) => (h >= 9 && h <= 18 ? 1.0 + 0.7 * Math.sin(((h - 9) / 9) * Math.PI) : 0.38) + r[h + 24] * 0.2);
    const hourly = Array.from({length: 24}, (_, h) => (h >= 7 && h <= 20 ? 1.6 + 1.3 * Math.sin(((h - 7) / 13) * Math.PI) : 0.4) + r[h] * 0.35);
    const loadDuration = Array.from({length: 60}, (_, i) => 7.9 * (1 - i / 59) ** 1.9 + 0.21);
    const live = Array.from({length: 60}, (_, i) => 2.1 + 0.9 * Math.sin(i / 7) + r[i] * 0.7);

    return {
        meta: {rangeLabel: 'Jun 1 – Jun 30, 2026', rangeHours: 720, deviceCount: 15, onlineCount: 14, currency: '€'},
        config: {tariff: true, groups: true, kinds: true, solar: true},
        overview: {
            consumptionKwh: 1284, costValue: 412.36, projectedValue: 468, dailyAvgKwh: 42.8,
            consumptionDeltaPct: 6.2, costDeltaPct: 4.8,
            alwaysOnKwh: 153, voltagePass: true, voltageAvgV: 231.4, dataQualityPct: 98.6,
            bill: {energy: 412.36, demandKw: 7.9, demand: 38.5, standing: 12.4, vatPct: 21, vat: 97.28, total: 560.54, vsUtility: 563.1, deltaPct: -0.5},
            tou: {energy: 412.36, shiftKwh: 42, shiftSave: 9.1, dayPct: 64, nightPct: 36, dayCost: 264, nightCost: 148},
            consumption: points(consumption, dayLabel),
            returned: points(returned, dayLabel),
            projection: points(projection, (i) => `Jul ${i}`),
        },
        power: {
            liveKw: 2.41, liveNote: '−0.84 kW exporting on ch B', peakKw: 7.9, billedKw: 7.9, loadFactor: 0.34,
            apparentKvah: 1382, reactiveKvarh: 486, en50160Events: 2, frequencyHz: 49.98, frequencyRange: '49.91 – 50.06 · ±0.04',
            powerFactor: 0.94, powerFactorRange: '0.87 – 0.99', voltageAvgV: 231.4, voltageRange: '224 – 239 V',
            phases: [
                {name: 'L1', watts: 912, volts: 233, amps: 4.1, pct: 88},
                {name: 'L2', watts: 1038, volts: 231, amps: 4.6, pct: 100},
                {name: 'L3', watts: 862, volts: 230, amps: 3.9, pct: 76},
            ],
            phaseImbalancePct: 4.2, phaseWorst: 'Compressor B · 9.8%',
            live: points(live, hourLabel),
        },
        energy: {
            rhythmWeekday: points(rhythmWeekday, hourLabel),
            rhythmWeekend: points(rhythmWeekend, hourLabel),
            peakHourLabel: '19:00',
            utility: [
                {name: 'Electricity', label: '1,284 kWh · €412'},
                {name: 'Gas', label: '212 m³ · €187'},
                {name: 'Water', label: '14,800 l · €42'},
                {name: 'Heat', label: '96 kWh · €11'},
            ],
            weekdayKwh: 976, weekendKwh: 308, weekdayPerDay: 45.5, weekendPerDay: 38.5,
            env: {temp: '22.4 °C', humidity: '47 %', luminance: '412 lx', flow: '0.06 m³/h'},
            loadDuration: points(loadDuration, (i) => `${Math.round((i / 59) * 720)} h`),
            alwaysOnW: 212,
            hourly: points(hourly, hourLabel),
        },
        devices: {
            shareTotalKwh: 1284,
            consumers: [
                {name: 'HVAC rooftop unit', meta: 'HVAC · Pro 3EM', kwh: 526, cost: 169, sharePct: 41, liveW: 1420, deltaLabel: '+8.4%', deltaKind: 'up'},
                {name: 'Walk-in refrigeration', meta: 'Refrigeration · Pro 3EM', kwh: 295, cost: 95, sharePct: 23, liveW: 610, deltaLabel: '+34%', deltaKind: 'bad'},
                {name: 'Lighting circuits', meta: 'Lighting · PM Mini', kwh: 218, cost: 70, sharePct: 17, liveW: 180, deltaLabel: '−2.1%', deltaKind: 'ok'},
                {name: 'Espresso machine', meta: 'Kitchen · Plug S', kwh: 86, cost: 27.6, sharePct: 6.7, liveW: 0, deltaLabel: '+1.2%', deltaKind: 'up'},
                {name: 'Dishwasher', meta: 'Kitchen · Plug S', kwh: 64, cost: 20.5, sharePct: 5, liveW: 0, deltaLabel: '−4.8%', deltaKind: 'ok'},
                {name: 'Server rack', meta: 'IT · PM Mini', kwh: 52, cost: 16.7, sharePct: 4.1, liveW: 190, deltaLabel: '+0.4%', deltaKind: 'up'},
                {name: 'EV charger', meta: 'Parking · EM', kwh: 43, cost: 13.8, sharePct: 3.3, liveW: 240, deltaLabel: '−12%', deltaKind: 'ok'},
            ],
            byLocation: [
                {label: 'Ground floor', value: '642 kWh'},
                {label: 'Kitchen', value: '359 kWh', indent: 1},
                {label: 'Café bar', value: '283 kWh', indent: 1},
                {label: 'Roof', value: '526 kWh'},
                {label: 'Unassigned', value: '116 kWh', muted: true},
                {label: '3 more not shown', value: '—', muted: true},
            ],
            byKind: [
                {label: 'HVAC', value: '526 kWh · 41%'},
                {label: 'Refrigeration', value: '295 kWh · 23%'},
                {label: 'Lighting', value: '218 kWh · 17%'},
                {label: 'Other', value: '245 kWh · 19%'},
            ],
            tenants: [
                {label: 'Unit A · Café', value: '€214.80'},
                {label: 'Unit B · Studio', value: '€118.16'},
                {label: 'Common areas', value: '€79.40'},
            ],
            meters: [
                {meter: 'EM-01 · Main', role: 'main', live: '2,410 W', energy: '1,284 kWh', cost: '€412.36', delta: '+6.2%', quality: '99.4%', status: 'online', online: true},
                {meter: 'PM-04 · HVAC', role: 'submeter', live: '1,420 W', energy: '526 kWh', cost: '€168.90', delta: '+8.4%', quality: '99.1%', status: 'online', online: true},
                {meter: 'PM-07 · Refrigeration', role: 'submeter', live: '610 W', energy: '295 kWh', cost: '€94.70', delta: '+34%', quality: '98.8%', status: 'online', online: true},
                {meter: 'PM-11 · Lighting', role: 'submeter', live: '180 W', energy: '218 kWh', cost: '€70.00', delta: '−2.1%', quality: '97.6%', status: 'online', online: true},
                {meter: 'GM-02 · Gas', role: 'utility', live: '—', energy: '212 m³', cost: '€187.40', delta: '+3.0%', quality: '99.0%', status: 'online', online: true},
                {meter: 'PM-14 · EV charger', role: 'submeter', live: '240 W', energy: '43 kWh', cost: '€13.80', delta: '−12%', quality: '91.2%', status: 'offline 2h', online: false},
            ],
        },
        solar: {
            flow: {solar: 3.28, grid: 0, home: 2.41, battery: 0.63, ev: 0.24},
            generatedToday: 24.6, selfConsumed: 19.9, exported: 4.7, imported: 6.1,
            pv: {generation: 642, selfConsumed: 520, exported: 122, gridImport: 764, house: 1284, selfConsumptionPct: 81, selfSufficiencyPct: 40},
            battery: {charged: 214, discharged: 196, roundTripPct: 91.6, losses: 18},
            ev: {delivered: 96, sessions: 3, avgPerSession: 32, cost: 30.7, co2Avoided: 42},
        },
        carbon: {
            locationBasedKg: 286, marketBasedKg: 0, avoidedKg: 144, equivalentKm: 1640,
            budgetKg: 3400, projectedKg: 3427, usedPct: 50.4, overshootPct: 0.8,
            anomalies: [
                {color: '#FF453A', icon: 'hi', title: 'High consumer', body: 'Walk-in refrigeration <b>+34%</b> vs baseline · Jun 18–19', pill: 'ACTIVE', pillClass: 'p-bad'},
                {color: '#FF9F0A', icon: 'v', title: 'Voltage high', body: '<b>238.6 V</b> on L1 · 2 EN 50160 events', pill: '2 EVENTS', pillClass: 'p-warn'},
                {color: '#FF9F0A', icon: 'ph', title: 'Phase imbalance', body: 'Compressor B at <b>9.8%</b> · threshold 8%', pill: 'WATCH', pillClass: 'p-warn'},
                {color: '#30D158', icon: 'ao', title: 'Always-on spike', body: 'baseline stable at <b>212 W</b>', pill: 'CLEAR', pillClass: 'p-ok'},
                {color: '#30D158', icon: 'co', title: 'Carbon budget', body: 'projected <b>+0.8%</b> · within tolerance', pill: 'ON TRACK', pillClass: 'p-ok'},
                {color: '#30D158', icon: 'v', title: 'Voltage low', body: 'no undervoltage events this period', pill: 'CLEAR', pillClass: 'p-ok'},
            ],
            recommendations: [
                {color: '#0A84FF', icon: 'ao', title: 'TOU opportunity', body: 'Shift <b>42 kWh</b> of dishwashing off-peak → save <b>€9.10</b>/mo', pill: 'SAVE €9', pillClass: 'p-ok'},
                {color: '#FFD60A', icon: 'v', title: 'What-if · add solar', body: '+3 kWp string → est. <b>−€21/mo</b> · <b>−38 kg CO₂</b>', pill: 'MODEL', pillClass: 'p-warn'},
                {color: '#30D158', icon: 'co', title: 'Time-shift', body: 'Pre-cool HVAC at 15:30 instead of 18:00 → <b>−12 kg CO₂</b>/mo', pill: 'SAVE CO₂', pillClass: 'p-ok'},
                {color: '#FF453A', icon: 'hi', title: 'Top-consumer spike', body: 'Inspect refrigeration door seal · est. <b>€4.20</b> excess', pill: 'ACT', pillClass: 'p-bad'},
                {color: '#FF9F0A', icon: 'off', title: 'Device offline', body: 'PM-14 EV charger silent for <b>2h</b>', pill: 'CHECK', pillClass: 'p-warn'},
                {color: '#30D158', icon: 'ph', title: 'PF penalty', body: 'PF <b>0.94</b> · no penalty applied', pill: 'CLEAR', pillClass: 'p-ok'},
            ],
        },
    };
}

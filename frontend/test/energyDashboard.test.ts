import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/tools/websocket', () => ({
    sendRPC: vi.fn()
}));

import {
    buildHeatmap,
    calculateCostFromFlat,
    useEnergyDashboardStore
} from '@/stores/energyDashboard';

const BASE_SETTINGS = {
    dashboardId: 1,
    tariff: 0.25,
    currency: 'EUR',
    defaultRange: 'last_7_days',
    refreshInterval: 60000,
    enabledMetrics: [],
    chartSettings: {},
    tariffMode: 'single' as const,
    dayRate: null,
    nightRate: null,
    dayStart: '07:00:00',
    dayEnd: '23:00:00'
};

describe('energyDashboard store', () => {
    beforeEach(() => setActivePinia(createPinia()));

    it('consumptionDelta is null when no data', () => {
        const store = useEnergyDashboardStore();
        expect(store.consumptionDelta).toBeNull();
    });

    it('consumptionDelta calculates +12% correctly', () => {
        const store = useEnergyDashboardStore();
        store.periodData = {
            current: [
                {bucket: '2026-04-01T00:00:00Z', deviceId: 1, value: 112}
            ],
            previous: [
                {bucket: '2026-03-01T00:00:00Z', deviceId: 1, value: 100}
            ],
            granularity: 'day',
            from: '2026-04-01T00:00:00Z',
            to: '2026-04-02T00:00:00Z'
        };
        expect(store.consumptionDelta).toBe(12);
    });

    it('totalCost uses single tariff correctly', () => {
        const store = useEnergyDashboardStore();
        store.settings = {...BASE_SETTINGS, tariff: 0.25};
        store.periodData = {
            current: [
                {bucket: '2026-04-01T10:00:00Z', deviceId: 1, value: 100}
            ],
            previous: [],
            granularity: 'day',
            from: '2026-04-01T00:00:00Z',
            to: '2026-04-02T00:00:00Z'
        };
        expect(store.totalCost).toBeCloseTo(25, 2);
    });

    it('totalCost applies day rate to daytime bucket and night rate to nighttime bucket', () => {
        const store = useEnergyDashboardStore();
        store.settings = {
            ...BASE_SETTINGS,
            tariffMode: 'day_night',
            dayRate: 0.3,
            nightRate: 0.15,
            dayStart: '07:00:00',
            dayEnd: '23:00:00'
        };
        store.periodData = {
            current: [
                {bucket: '2026-04-01T10:00:00Z', deviceId: 1, value: 10}, // day → 10 * 0.30 = 3.00
                {bucket: '2026-04-01T02:00:00Z', deviceId: 1, value: 10} // night → 10 * 0.15 = 1.50
            ],
            previous: [],
            granularity: 'hour',
            from: '2026-04-01T00:00:00Z',
            to: '2026-04-02T00:00:00Z'
        };
        expect(store.totalCost).toBeCloseTo(4.5, 2);
    });

    it('projectedMonthlyCost is based on selected range duration', () => {
        const store = useEnergyDashboardStore();
        store.settings = {...BASE_SETTINGS, tariff: 0.25};
        store.periodData = {
            current: [{bucket: '2026-04-01T00:00:00Z', deviceId: 1, value: 70}],
            previous: [],
            granularity: 'day',
            from: '2026-04-01T00:00:00Z',
            to: '2026-04-08T00:00:00Z'
        };
        // cost = 70 * 0.25 = 17.50, projected = (17.50 / 7) * 30 = 75
        expect(store.projectedMonthlyCost).toBeCloseTo(75, 0);
    });

    it('meterRows are sorted by consumptionPeriod descending', () => {
        const store = useEnergyDashboardStore();
        store.settings = {...BASE_SETTINGS};
        store.periodData = {
            current: [
                {bucket: '2026-04-01T10:00:00Z', deviceId: 1, value: 10},
                {bucket: '2026-04-01T10:00:00Z', deviceId: 2, value: 50}
            ],
            previous: [],
            granularity: 'day',
            from: '2026-04-01T00:00:00Z',
            to: '2026-04-02T00:00:00Z'
        };
        store.liveDevices = [
            {id: 1, name: 'Meter A', power: 100, online: true},
            {id: 2, name: 'Meter B', power: 500, online: true}
        ];
        expect(store.meterRows[0].deviceName).toBe('Meter B');
        expect(store.meterRows[1].deviceName).toBe('Meter A');
    });
});

describe('calculateCostFromFlat', () => {
    it('single rate: multiplies all values by tariff', () => {
        const result = calculateCostFromFlat(
            [{bucket: '2026-04-01T10:00:00Z', deviceId: 1, value: 10}],
            {...BASE_SETTINGS, tariff: 0.5}
        );
        expect(result).toBeCloseTo(5, 2);
    });

    it('day/night: applies correct rate based on hour', () => {
        const s = {
            ...BASE_SETTINGS,
            tariffMode: 'day_night' as const,
            dayRate: 0.3,
            nightRate: 0.1,
            dayStart: '07:00:00',
            dayEnd: '23:00:00'
        };
        const result = calculateCostFromFlat(
            [
                {bucket: '2026-04-01T12:00:00Z', deviceId: 1, value: 10}, // day
                {bucket: '2026-04-01T03:00:00Z', deviceId: 1, value: 10} // night
            ],
            s
        );
        expect(result).toBeCloseTo(4.0, 2); // 3.0 + 1.0
    });
});

describe('buildHeatmap', () => {
    it('aggregates values by day and hour', () => {
        // 2026-04-01 is a Wednesday (day 3), 10:00 UTC
        const data = [
            {bucket: '2026-04-01T10:00:00Z', deviceId: 1, value: 5},
            {bucket: '2026-04-01T10:00:00Z', deviceId: 2, value: 3}
        ];
        const result = buildHeatmap(data);
        const cell = result.find((r) => r.hour === 10);
        expect(cell?.value).toBeCloseTo(8, 2);
        expect(cell?.day).toBe(new Date('2026-04-01T10:00:00Z').getUTCDay()); // 3 = Wednesday
    });
});

/** Dashboard settings defaults — single ENV-backed source of truth. */
import {getLogger} from 'log4js';
import {envFloat, envInt, envStr} from './envReader';

export interface DashboardBaseDefaults {
    tariff: number;
    currency: string;
    defaultRange: string;
    refreshIntervalMs: number;
    enabledMetrics: readonly string[];
    tariffMode: 'single' | 'day_night' | 'tou';
    dayRate: number | null;
    nightRate: number | null;
    dayStart: string;
    dayEnd: string;
    tariffTimezone: string;
}

const DEFAULT_ENABLED_METRICS = [
    'voltage',
    'current',
    'power',
    'consumption',
    'temperature',
    'humidity',
    'luminance'
] as const;
const logger = getLogger('config.dashboardDefaults');
const TARIFF_MODES = ['single', 'day_night', 'tou'] as const;
type TariffMode = (typeof TARIFF_MODES)[number];

export function dashboardDefaults(): DashboardBaseDefaults {
    const tariffMode = envStr('FM_DASHBOARD_DEFAULT_TARIFF_MODE', 'single');
    return {
        tariff: envFloat('FM_DASHBOARD_DEFAULT_TARIFF', 0, 0, 1_000_000),
        currency: envStr('FM_DASHBOARD_DEFAULT_CURRENCY', 'EUR'),
        defaultRange: envStr('FM_DASHBOARD_DEFAULT_RANGE', 'last_7_days'),
        refreshIntervalMs: envInt('FM_DASHBOARD_REFRESH_MS', 60_000, 1_000),
        enabledMetrics: DEFAULT_ENABLED_METRICS,
        tariffMode: normaliseTariffMode(tariffMode),
        dayRate: nullableFloat('FM_DASHBOARD_DAY_RATE'),
        nightRate: nullableFloat('FM_DASHBOARD_NIGHT_RATE'),
        dayStart: normaliseClock(
            'FM_DASHBOARD_DAY_START',
            envStr('FM_DASHBOARD_DAY_START', '07:00:00'),
            '07:00:00'
        ),
        dayEnd: normaliseClock(
            'FM_DASHBOARD_DAY_END',
            envStr('FM_DASHBOARD_DAY_END', '23:00:00'),
            '23:00:00'
        ),
        tariffTimezone: envStr('FM_DASHBOARD_TARIFF_TIMEZONE', 'UTC')
    };
}

function normaliseTariffMode(value: string): TariffMode {
    if ((TARIFF_MODES as readonly string[]).includes(value)) {
        return value as TariffMode;
    }
    logger.warn(
        'Invalid FM_DASHBOARD_DEFAULT_TARIFF_MODE=%s; using single',
        value
    );
    return 'single';
}

function normaliseClock(name: string, value: string, fallback: string): string {
    const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value);
    if (!match) {
        logger.warn('Invalid %s=%s; using %s', name, value, fallback);
        return fallback;
    }
    return `${match[1]}:${match[2]}:${match[3] ?? '00'}`;
}

function nullableFloat(name: string): number | null {
    const raw = process.env[name];
    if (!raw) return null;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n : null;
}

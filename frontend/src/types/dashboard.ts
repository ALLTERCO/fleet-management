import type {Dashboard, DashboardType} from '@api/dashboard';

export type {Dashboard, DashboardType};

/**
 * Frontend-only subset: excludes 'classic' and 'analytics' — those have their
 * own creation/edit UI. DomainDashboardType drives the domain type-picker.
 */
export type DomainDashboardType = Exclude<
    DashboardType,
    'classic' | 'analytics'
>;

export const DOMAIN_TYPES: DomainDashboardType[] = [
    'overview',
    'energy',
    'environment',
    'map'
];

export const DOMAIN_TYPE_META: Record<
    DomainDashboardType,
    {
        label: string;
        description: string;
        icon: string;
        defaultName: string;
        detects: string[];
    }
> = {
    overview: {
        label: 'Overview',
        description: 'At-a-glance summary of all devices and metrics',
        icon: 'fas fa-gauge-high',
        defaultName: 'Overview',
        detects: [
            'em',
            'em1',
            'pm1',
            'switch',
            'temperature',
            'humidity',
            'illuminance',
            'flood',
            'smoke',
            'presence',
            'bthomesensor',
            'bthomedevice',
            'devicepower'
        ]
    },
    energy: {
        label: 'Energy',
        description:
            'Consumption, cost, and power tracking with period comparison',
        icon: 'fas fa-bolt',
        defaultName: 'Energy',
        detects: ['em', 'em1', 'pm1', 'switch']
    },
    environment: {
        label: 'Environment',
        description:
            'Temperature, humidity, illuminance, and sensor monitoring',
        icon: 'fas fa-temperature-half',
        defaultName: 'Environment',
        detects: [
            'temperature',
            'humidity',
            'illuminance',
            'flood',
            'smoke',
            'bthomesensor'
        ]
    },
    control: {
        label: 'Control',
        description:
            'Operate switches, lights, covers, thermostats, BLU controls',
        icon: 'fas fa-toggle-on',
        defaultName: 'Control',
        detects: [
            'switch',
            'light',
            'cover',
            'input',
            'rgb',
            'rgbw',
            'cct',
            'rgbcct',
            'thermostat',
            'blutrv',
            'bthomecontrol'
        ]
    },
    safety: {
        label: 'Safety',
        description:
            'Alerts, incidents, BLU door/window/motion + safety sensors',
        icon: 'fas fa-shield-halved',
        defaultName: 'Safety',
        detects: [
            'flood',
            'smoke',
            'presence',
            'bthomesensor',
            'bthomedevice',
            'bthomecontrol'
        ]
    },
    map: {
        label: 'Map',
        description:
            'Geospatial overview of all locations with drill-down into sites, buildings, and floors',
        icon: 'fas fa-map-location-dot',
        defaultName: 'Map',
        detects: []
    }
};

// Icon strategy for every dashboard type the UI knows about — single home
// for icon, accent class, and label so palette, manage list, and KPI strip
// stay aligned without duplicating the switch.
export interface DashboardTypeAppearance {
    readonly icon: string;
    readonly accent: string;
    readonly label: string;
}

const DASHBOARD_TYPE_FALLBACK: DashboardTypeAppearance = {
    icon: 'fas fa-table-cells-large',
    accent: 'neutral',
    label: 'Dashboard'
};

const DASHBOARD_TYPE_APPEARANCE: Readonly<
    Record<string, DashboardTypeAppearance>
> = {
    classic: {
        icon: 'fas fa-table-cells-large',
        accent: 'primary',
        label: 'Classic'
    },
    analytics: {
        icon: 'fas fa-chart-line',
        accent: 'success',
        label: 'Analytics'
    },
    overview: {
        ...DOMAIN_TYPE_META.overview,
        accent: 'primary',
        label: DOMAIN_TYPE_META.overview.label
    },
    energy: {
        ...DOMAIN_TYPE_META.energy,
        accent: 'energy',
        label: DOMAIN_TYPE_META.energy.label
    },
    environment: {
        ...DOMAIN_TYPE_META.environment,
        accent: 'environment',
        label: DOMAIN_TYPE_META.environment.label
    },
    control: {
        ...DOMAIN_TYPE_META.control,
        accent: 'primary',
        label: DOMAIN_TYPE_META.control.label
    },
    safety: {
        ...DOMAIN_TYPE_META.safety,
        accent: 'danger',
        label: DOMAIN_TYPE_META.safety.label
    },
    map: {
        ...DOMAIN_TYPE_META.map,
        accent: 'primary',
        label: DOMAIN_TYPE_META.map.label
    }
};

export function appearanceForDashboardType(
    type: string | undefined
): DashboardTypeAppearance {
    if (!type) return DASHBOARD_TYPE_FALLBACK;
    return DASHBOARD_TYPE_APPEARANCE[type] ?? DASHBOARD_TYPE_FALLBACK;
}

export interface TouWindow {
    from: string;
    to: string;
    rate: number;
    label: string;
}

export interface DashboardSettings {
    dashboardId: number;
    tariff: number;
    currency: string;
    defaultRange: string;
    refreshInterval: number;
    enabledMetrics: string[];
    chartSettings: Record<string, unknown>;
    tariffMode: 'single' | 'day_night' | 'tou';
    dayRate: number | null;
    nightRate: number | null;
    dayStart: string;
    dayEnd: string;
    /** IANA TZ for HH:MM windows. null = UTC backfill. */
    tariffTimezone?: string | null;
    /** Populated only when tariffMode='tou'. */
    tariffWindows?: TouWindow[] | null;
    /** Weekend/holiday schedule, same shape. */
    tariffWeekendOverride?: TouWindow[] | null;
    /** ISO date strings on which the weekend override applies. */
    tariffHolidays?: string[] | null;
    // Location-based (LBM) grid emission factor in g CO₂e/kWh. null → env default.
    emissionFactorGPerKWh?: number | null;
    // Market-based (MBM) emission factor for green-PPA/REC reporting.
    emissionFactorMbmGPerKWh?: number | null;
    // Per-period CO₂ budget in kg. Breach drives a Report.Anomaly push.
    co2BudgetKg?: number | null;
    // Org tariff library reference. null = inline rates on this dashboard.
    tariffId?: number | null;
    // Devices counted toward peak-power figure. null = all devices in scope.
    peakDeviceIds?: string[] | null;
    // PV setup: mode + which meters are grid vs generation. null = no PV.
    pvMode?: 'parallel' | 'backup' | 'balcony' | null;
    pvGridRefs?: PvMeterRef[] | null;
    pvGenerationRefs?: PvMeterRef[] | null;
}

export interface PvMeterRef {
    device: string;
    channel: number | null;
}

/** Alias kept for existing call sites; shape comes from the backend. */
export type DomainDashboard = Dashboard;

// View-model contract: one home for the shape the mapper produces and the
// presenter renders, so the two never drift.

import type {
    DashDeviceRow,
    DashInsight,
    DashKpiMetric
} from '@/types/dashboard-components';

// ── Sensor-kind catalog (SSOT for label + unit) ──

/** Kinds the dashboard reads. Grouped by the tab that surfaces them. */
export const ENV_KIND_META: Record<string, {label: string; unit: string}> = {
    temperature: {label: 'Temperature', unit: '°C'},
    humidity: {label: 'Humidity', unit: '%'},
    illuminance: {label: 'Illuminance', unit: 'lux'},
    co2: {label: 'CO₂', unit: 'ppm'},
    tvoc: {label: 'TVOC', unit: 'ppb'},
    pm25: {label: 'PM2.5', unit: 'µg/m³'},
    pm10: {label: 'PM10', unit: 'µg/m³'},
    pressure: {label: 'Pressure', unit: 'hPa'},
    dewpoint: {label: 'Dew point', unit: '°C'},
    uv: {label: 'UV index', unit: ''},
    // Wind is stored as 'wind_speed' (WS90 override / BTHome), never 'wind'.
    wind_speed: {label: 'Wind', unit: 'm/s'},
    precipitation: {label: 'Rain', unit: 'mm'},
    moisture: {label: 'Soil moisture', unit: '%'},
    battery: {label: 'Battery', unit: '%'}
};

/** Kinds routed to the Air Quality tab. */
export const ENV_AIR_KINDS = ['co2', 'tvoc', 'pm25', 'pm10'] as const;
/** Kinds routed to the Weather tab (only shown when present in data). */
export const ENV_WEATHER_KINDS = [
    'pressure',
    'wind_speed',
    'precipitation'
] as const;

/** Event kinds routed to the Presence & Activity tab. */
export const ENV_PRESENCE_KINDS = [
    'occupancy',
    'motion',
    'door',
    'window',
    'button'
] as const;
/** Event kinds routed to the Safety tab (state 1 = alarm). */
export const ENV_SAFETY_KINDS = ['flood', 'smoke', 'gas', 'co', 'vibration'] as const;

/** Label per event kind — SSOT for the presence + safety tabs. */
export const ENV_EVENT_META: Record<string, string> = {
    occupancy: 'Occupancy',
    motion: 'Motion',
    door: 'Door',
    window: 'Window',
    button: 'Button',
    flood: 'Water leak',
    smoke: 'Smoke',
    gas: 'Gas',
    co: 'Carbon monoxide',
    vibration: 'Vibration'
};

// ── Tunables (comfort + air-quality bands) ──

/** Comfort and air thresholds. Sourced from dashboard settings; defaults
 *  below. No hardcoded tunables scattered in the mapper or presenter. */
export interface EnvSettings {
    tempComfortMin: number;
    tempComfortMax: number;
    humidityComfortMin: number;
    humidityComfortMax: number;
    moldHumidityThreshold: number;
    co2FairPpm: number;
    co2PoorPpm: number;
    pm25FairUgm3: number;
    pm25PoorUgm3: number;
    daylightLux: number;
}

export const DEFAULT_ENV_SETTINGS: EnvSettings = {
    tempComfortMin: 20,
    tempComfortMax: 24,
    humidityComfortMin: 30,
    humidityComfortMax: 60,
    moldHumidityThreshold: 70,
    co2FairPpm: 800,
    co2PoorPpm: 1200,
    pm25FairUgm3: 15,
    pm25PoorUgm3: 35,
    daylightLux: 1000
};

// ── Mapper input (already scoped by the page) ──

/** One sensor-history bucket, narrowed to the active scope. Mirrors
 *  SensorQueryRow with `device` aliased to `deviceId` for readability. */
export interface EnvHistoryRow {
    bucket: string;
    deviceId: number;
    kind: string;
    value: number;
    min: number | null;
    max: number | null;
    source: string;
    channel: number | null;
    sampleCount: number;
}

/** One discrete sensor event, scoped and named at the page (the raw
 *  SensorEventRow carries no device name). Drives presence + safety. */
export interface EnvEventRow {
    ts: string;
    deviceId: number;
    name: string;
    kind: string;
    /** Binary sensors 0/1; buttons carry the push code (1-4). */
    state: number;
    source: string;
}

/** One live per-sensor reading from fleet.GetMetrics. */
export interface EnvLiveReading {
    deviceId: number;
    value: number;
}

/** Live snapshot. Covers the big three; other kinds are history-only, which
 *  is fine since live only drives KPIs and current readings. */
export interface EnvLiveMetrics {
    temperature: EnvLiveReading[];
    humidity: EnvLiveReading[];
    luminance: EnvLiveReading[];
}

/** Per-sensor device facts for the Sensors tab. */
export interface EnvSensorInfo {
    id: number;
    shellyId: string;
    name: string;
    online: boolean;
    source: string;
    battery: number | null;
}

export interface EnvMeta {
    scopeName: string;
    from: string;
    to: string;
    granularity: string;
    generatedAt: number;
    /** Percent of scoped sensors that reported at least one live reading. */
    dataQualityPct: number;
}

export interface EnvironmentDashboardInput {
    meta: Omit<EnvMeta, 'dataQualityPct'>;
    live: EnvLiveMetrics;
    history: EnvHistoryRow[];
    events: EnvEventRow[];
    sensors: EnvSensorInfo[];
    settings: EnvSettings;
    loading?: boolean;
}

// ── View-model (what the presenter renders) ──

/** A time-series bucket carrying its band, for shaded min/max charts. */
export interface EnvBandPoint {
    bucket: string;
    value: number;
    min: number;
    max: number;
}

/** One sensor kind rolled up for a tab: headline stats + its series. */
export interface EnvKindBlock {
    kind: string;
    label: string;
    unit: string;
    avg: number | null;
    min: number | null;
    max: number | null;
    series: EnvBandPoint[];
}

export type EnvTabKey =
    | 'overview'
    | 'comfort'
    | 'air'
    | 'light'
    | 'weather'
    | 'presence'
    | 'safety'
    | 'sensors'
    | 'quality';

export interface EnvConfig {
    /** Tabs to show, already filtered to kinds present in the data. */
    tabs: EnvTabKey[];
    settings: EnvSettings;
}

export interface EnvOverview {
    kpis: DashKpiMetric[];
    temperature: EnvBandPoint[];
    humidity: EnvBandPoint[];
    comfortScore: number | null;
    comfortLabel: string;
    insights: DashInsight[];
}

export interface EnvComfort {
    temperature: EnvKindBlock;
    humidity: EnvKindBlock;
    feelsLike: number | null;
    dewPoint: number | null;
    /** 0..100 percent of buckets inside the comfort band. */
    comfortScore: number | null;
    /** Sample-weighted hours the temperature sat inside the band. */
    hoursInBand: number;
    moldRisk: boolean;
    /** 7×24 weekday×hour average temperature for the rhythm heatmap. */
    rhythm: number[][];
}

export type AirBand = 'good' | 'fair' | 'poor';

export interface EnvAir {
    /** Present kinds only — nulls hide their cards. */
    co2: EnvKindBlock | null;
    tvoc: EnvKindBlock | null;
    pm25: EnvKindBlock | null;
    pm10: EnvKindBlock | null;
    band: AirBand | null;
}

export interface EnvLight {
    illuminance: EnvKindBlock | null;
    uv: EnvKindBlock | null;
    daylightHours: number | null;
}

export interface EnvWeather {
    pressure: EnvKindBlock | null;
    wind: EnvKindBlock | null;
    rain: EnvKindBlock | null;
}

// ── Presence & activity ──

/** One activity kind rolled up: total events + when it last fired. */
export interface EnvActivityKind {
    kind: string;
    label: string;
    count: number;
    lastTs: string | null;
}

/** Events per time bucket, for the activity chart (TimePoint shape). */
export interface EnvActivityPoint {
    bucket: string;
    value: number;
}

export interface EnvPresence {
    kinds: EnvActivityKind[];
    timeline: EnvActivityPoint[];
    totalEvents: number;
    /** Hour-of-day (0..23) with the most activity; null when no events. */
    busiestHour: number | null;
}

// ── Safety ──

export type SafetyStatus = 'clear' | 'alarm' | 'unknown';

/** One safety sensor stream (device + kind) with its current status. */
export interface EnvSafetySensor {
    deviceId: number;
    name: string;
    kind: string;
    label: string;
    status: SafetyStatus;
    lastTs: string | null;
    /** Alarm events (state ≥ 1) in the window. */
    alarms: number;
}

export interface EnvSafety {
    sensors: EnvSafetySensor[];
    /** Sensors whose latest event is an alarm. */
    alarmsActive: number;
    /** Total alarm events across all safety sensors in the window. */
    alarmsTotal: number;
}

// ── Data quality ──

/** Reporting coverage for one physical numeric stream. */
export interface EnvQualityStream {
    deviceId: number;
    name: string;
    kind: string;
    label: string;
    source: string;
    channel: number | null;
    readings: number;
    /** Reported buckets / expected buckets, 0..100. */
    coveragePct: number;
    buckets: number;
    expected: number;
    lastTs: string | null;
}

export interface EnvQuality {
    /** Mean stream coverage across the window, 0..100. */
    overallPct: number;
    /** Sensors reporting a live reading / total, 0..100. */
    onlinePct: number;
    /** Buckets expected per stream for the window + granularity. */
    expectedBuckets: number;
    streams: EnvQualityStream[];
}

/** Per-sensor row — DashDeviceRow plus the readings the table shows. */
export interface EnvSensorRow extends DashDeviceRow {
    source: string;
    battery: number | null;
    temperature: number | null;
    humidity: number | null;
    luminance: number | null;
}

export interface EnvironmentDashboardData {
    meta: EnvMeta;
    config: EnvConfig;
    overview: EnvOverview;
    comfort: EnvComfort;
    air: EnvAir;
    light: EnvLight;
    weather: EnvWeather;
    presence: EnvPresence;
    safety: EnvSafety;
    quality: EnvQuality;
    sensors: EnvSensorRow[];
}

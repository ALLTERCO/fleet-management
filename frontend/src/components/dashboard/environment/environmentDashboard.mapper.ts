// Producer: scoped raw data (live + history) into EnvironmentDashboardData.
// Only place that touches raw rows. Derived-index helpers are exported for tests.

import type {DashInsight, DashKpiMetric} from '@/types/dashboard-components';
import {
    type AirBand,
    ENV_AIR_KINDS,
    ENV_EVENT_META,
    ENV_KIND_META,
    ENV_PRESENCE_KINDS,
    ENV_SAFETY_KINDS,
    ENV_WEATHER_KINDS,
    type EnvActivityKind,
    type EnvActivityPoint,
    type EnvAir,
    type EnvBandPoint,
    type EnvComfort,
    type EnvEventRow,
    type EnvHistoryRow,
    type EnvironmentDashboardData,
    type EnvironmentDashboardInput,
    type EnvKindBlock,
    type EnvLight,
    type EnvLiveReading,
    type EnvOverview,
    type EnvPresence,
    type EnvQuality,
    type EnvQualityStream,
    type EnvSafety,
    type EnvSafetySensor,
    type EnvSensorInfo,
    type EnvSensorRow,
    type EnvSettings,
    type EnvTabKey,
    type EnvWeather,
    type SafetyStatus
} from './environmentDashboard.types';

// ── Small numeric helpers ──

function mean(values: number[]): number | null {
    if (!values.length) return null;
    return values.reduce((s, v) => s + v, 0) / values.length;
}

function avgOfReadings(readings: EnvLiveReading[]): number | null {
    return mean(readings.map((r) => r.value));
}

function round(value: number | null, decimals = 1): number | null {
    // Coerce NaN/Infinity to null so no non-finite value ever reaches the UI
    // (e.g. dewPointC returns NaN at 0% RH).
    if (value == null || !Number.isFinite(value)) return null;
    const f = 10 ** decimals;
    return Math.round(value * f) / f;
}

// ── Derived indices (pure, unit-tested) ──

/** Feels-like temperature (°C) via the NWS heat index. Below 27°C the index
 *  is not defined, so we return the actual temperature. */
export function heatIndexC(tempC: number, rh: number): number {
    if (tempC < 27) return tempC;
    const t = (tempC * 9) / 5 + 32; // formula is in Fahrenheit
    const r = rh;
    const simple = 0.5 * (t + 61 + (t - 68) * 1.2 + r * 0.094);
    if (simple < 80) return ((simple - 32) * 5) / 9;
    let hi =
        -42.379 +
        2.04901523 * t +
        10.14333127 * r -
        0.22475541 * t * r -
        0.00683783 * t * t -
        0.05481717 * r * r +
        0.00122874 * t * t * r +
        0.00085282 * t * r * r -
        0.00000199 * t * t * r * r;
    if (r < 13 && t >= 80 && t <= 112) {
        hi -= ((13 - r) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17);
    } else if (r > 85 && t >= 80 && t <= 87) {
        hi += ((r - 85) / 10) * ((87 - t) / 5);
    }
    return ((hi - 32) * 5) / 9;
}

/** Dew point (°C) via the Magnus-Tetens approximation. */
export function dewPointC(tempC: number, rh: number): number {
    if (rh <= 0) return Number.NaN;
    const a = 17.625;
    const b = 243.04;
    const gamma = Math.log(rh / 100) + (a * tempC) / (b + tempC);
    return (b * gamma) / (a - gamma);
}

/** Percent of buckets (0..100) where temperature AND humidity sit inside the
 *  comfort band. Aligned by bucket; null when the two series never overlap. */
export function comfortScore(
    temperature: EnvBandPoint[],
    humidity: EnvBandPoint[],
    settings: EnvSettings
): number | null {
    const humByBucket = new Map(humidity.map((p) => [p.bucket, p.value]));
    let inBand = 0;
    let considered = 0;
    for (const t of temperature) {
        const h = humByBucket.get(t.bucket);
        if (h == null) continue;
        considered++;
        const tempOk =
            t.value >= settings.tempComfortMin &&
            t.value <= settings.tempComfortMax;
        const humOk =
            h >= settings.humidityComfortMin &&
            h <= settings.humidityComfortMax;
        if (tempOk && humOk) inBand++;
    }
    if (!considered) return null;
    return (inBand / considered) * 100;
}

/** Air-quality band from CO₂ and PM2.5 averages; worst of the two wins.
 *  null when neither reading is present. */
export function airQualityBand(
    co2Avg: number | null,
    pm25Avg: number | null,
    settings: EnvSettings
): AirBand | null {
    if (co2Avg == null && pm25Avg == null) return null;
    const co2Band: AirBand | null =
        co2Avg == null
            ? null
            : co2Avg > settings.co2PoorPpm
              ? 'poor'
              : co2Avg > settings.co2FairPpm
                ? 'fair'
                : 'good';
    const pmBand: AirBand | null =
        pm25Avg == null
            ? null
            : pm25Avg > settings.pm25PoorUgm3
              ? 'poor'
              : pm25Avg > settings.pm25FairUgm3
                ? 'fair'
                : 'good';
    const rank: Record<AirBand, number> = {good: 0, fair: 1, poor: 2};
    const bands = [co2Band, pmBand].filter((b): b is AirBand => b != null);
    return bands.reduce((worst, b) => (rank[b] > rank[worst] ? b : worst));
}

/** Average daylight hours per day: buckets above the daylight lux threshold,
 *  weighted by bucket length, divided by the day span. */
export function daylightHours(
    illuminance: EnvBandPoint[],
    thresholdLux: number,
    bucketHours: number,
    days: number
): number {
    const litBuckets = illuminance.filter(
        (p) => p.value >= thresholdLux
    ).length;
    return (litBuckets * bucketHours) / Math.max(1, days);
}

// ── Series aggregation ──

/** Roll history rows (one kind, many devices) into per-bucket band points:
 *  average value across devices, min of mins, max of maxes. */
export function aggregateBand(rows: EnvHistoryRow[]): EnvBandPoint[] {
    const byBucket = new Map<
        string,
        {sum: number; count: number; min: number; max: number}
    >();
    for (const r of rows) {
        const entry = byBucket.get(r.bucket) ?? {
            sum: 0,
            count: 0,
            min: Number.POSITIVE_INFINITY,
            max: Number.NEGATIVE_INFINITY
        };
        entry.sum += r.value;
        entry.count++;
        entry.min = Math.min(entry.min, r.min ?? r.value);
        entry.max = Math.max(entry.max, r.max ?? r.value);
        byBucket.set(r.bucket, entry);
    }
    return [...byBucket.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([bucket, e]) => ({
            bucket,
            value: e.sum / e.count,
            min: e.min,
            max: e.max
        }));
}

function kindBlock(history: EnvHistoryRow[], kind: string): EnvKindBlock {
    const meta = ENV_KIND_META[kind] ?? {label: kind, unit: ''};
    const series = aggregateBand(history.filter((r) => r.kind === kind));
    return {
        kind,
        label: meta.label,
        unit: meta.unit,
        avg: round(mean(series.map((p) => p.value))),
        min: series.length ? Math.min(...series.map((p) => p.min)) : null,
        max: series.length ? Math.max(...series.map((p) => p.max)) : null,
        series
    };
}

/** null when a kind has no rows, so the presenter can hide its card. */
function optionalKindBlock(
    history: EnvHistoryRow[],
    kind: string
): EnvKindBlock | null {
    if (!history.some((r) => r.kind === kind)) return null;
    return kindBlock(history, kind);
}

// ── Time helpers ──

// Keys are Sensor.Query / Energy.Query bucket strings (ENERGY_BUCKETS).
const GRANULARITY_HOURS: Record<string, number> = {
    '15 minutes': 0.25,
    '30 minutes': 0.5,
    '1 hour': 1,
    '6 hours': 6,
    '12 hours': 12,
    '1 day': 24,
    '1 week': 168,
    '1 month': 720
};

function bucketHoursFor(granularity: string): number {
    return GRANULARITY_HOURS[granularity] ?? 1;
}

function daySpan(from: string, to: string): number {
    const ms = new Date(to).getTime() - new Date(from).getTime();
    if (!Number.isFinite(ms) || ms <= 0) return 1;
    return Math.max(1, ms / 86_400_000);
}

// A weekday×hour rhythm needs a real hour-of-day; day+ buckets align to 00:00.
const HOURLY_OR_FINER = new Set(['15 minutes', '30 minutes', '1 hour']);

/** 7×24 weekday×hour average temperature for the rhythm chart. Unpopulated
 *  cells are NaN (not 0) so the presenter can tell "no data" from a real 0°C. */
function weekdayHourRhythm(rows: EnvHistoryRow[]): number[][] {
    const sum: number[][] = Array.from({length: 7}, () => Array(24).fill(0));
    const counts: number[][] = Array.from({length: 7}, () => Array(24).fill(0));
    for (const r of rows) {
        const d = new Date(r.bucket);
        if (Number.isNaN(d.getTime())) continue;
        sum[d.getDay()][d.getHours()] += r.value;
        counts[d.getDay()][d.getHours()]++;
    }
    return sum.map((row, day) =>
        row.map((total, hour) =>
            counts[day][hour] ? total / counts[day][hour] : Number.NaN
        )
    );
}

// ── Presence, safety, data quality ──

const PRESENCE_SET = new Set<string>(ENV_PRESENCE_KINDS);
const SAFETY_SET = new Set<string>(ENV_SAFETY_KINDS);
// Binary sensors: state ≥ 1 is active/open/alarm; buttons carry a push code.
const ALARM_STATE = 1;

function eventLabel(kind: string): string {
    return ENV_EVENT_META[kind] ?? kind;
}

/** Roll activity events into per-kind counts, a per-bucket timeline, and the
 *  busiest hour of day. Non-presence kinds are ignored. */
export function buildPresence(
    events: EnvEventRow[],
    granularity: string
): EnvPresence {
    const rows = events.filter((e) => PRESENCE_SET.has(e.kind));
    const byKind = new Map<string, {count: number; lastTs: string | null}>();
    const timeline = new Map<string, number>();
    const hourCounts = new Array(24).fill(0);
    const bucketMs = bucketHoursFor(granularity) * 3_600_000;
    for (const e of rows) {
        const k = byKind.get(e.kind) ?? {count: 0, lastTs: null};
        k.count++;
        if (!k.lastTs || e.ts > k.lastTs) k.lastTs = e.ts;
        byKind.set(e.kind, k);
        const d = new Date(e.ts);
        if (Number.isNaN(d.getTime())) continue;
        hourCounts[d.getHours()]++;
        const bucket = new Date(
            Math.floor(d.getTime() / bucketMs) * bucketMs
        ).toISOString();
        timeline.set(bucket, (timeline.get(bucket) ?? 0) + 1);
    }
    const kinds: EnvActivityKind[] = [...byKind.entries()]
        .map(([kind, v]) => ({
            kind,
            label: eventLabel(kind),
            count: v.count,
            lastTs: v.lastTs
        }))
        .sort((a, b) => b.count - a.count);
    const series: EnvActivityPoint[] = [...timeline.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([bucket, value]) => ({bucket, value}));
    const busiestHour = rows.length
        ? hourCounts.indexOf(Math.max(...hourCounts))
        : null;
    return {kinds, timeline: series, totalEvents: rows.length, busiestHour};
}

/** Per-sensor safety status from the latest event of each device+kind stream.
 *  Alarm streams sort to the top. Non-safety kinds are ignored. */
export function buildSafety(events: EnvEventRow[]): EnvSafety {
    const rows = events.filter((e) => SAFETY_SET.has(e.kind));
    const byStream = new Map<string, EnvEventRow[]>();
    for (const e of rows) {
        const key = `${e.deviceId}:${e.kind}`;
        const arr = byStream.get(key) ?? [];
        arr.push(e);
        byStream.set(key, arr);
    }
    const sensors: EnvSafetySensor[] = [...byStream.values()]
        .map((evs) => {
            // On an identical timestamp, the alarm (higher state) is treated as
            // latest so a same-instant clear never masks an active alarm.
            const sorted = [...evs].sort(
                (a, b) => a.ts.localeCompare(b.ts) || a.state - b.state
            );
            const last = sorted[sorted.length - 1];
            const alarms = evs.filter((e) => e.state >= ALARM_STATE).length;
            const status: SafetyStatus =
                last.state >= ALARM_STATE ? 'alarm' : 'clear';
            return {
                deviceId: last.deviceId,
                name: last.name,
                kind: last.kind,
                label: eventLabel(last.kind),
                status,
                lastTs: last.ts,
                alarms
            };
        })
        .sort(
            (a, b) =>
                Number(b.status === 'alarm') - Number(a.status === 'alarm')
        );
    return {
        sensors,
        alarmsActive: sensors.filter((s) => s.status === 'alarm').length,
        alarmsTotal: sensors.reduce((sum, s) => sum + s.alarms, 0)
    };
}

/** Reporting coverage per numeric stream: distinct buckets seen vs the buckets
 *  the window+granularity should hold. Worst-covered streams sort first. */
export function buildQuality(
    history: EnvHistoryRow[],
    sensors: EnvSensorInfo[],
    meta: {from: string; to: string; granularity: string},
    onlinePct: number
): EnvQuality {
    const windowMs =
        new Date(meta.to).getTime() - new Date(meta.from).getTime();
    const bucketMs = bucketHoursFor(meta.granularity) * 3_600_000;
    const expected =
        Number.isFinite(windowMs) && windowMs > 0
            ? Math.max(1, Math.round(windowMs / bucketMs))
            : 1;
    const nameById = new Map(sensors.map((s) => [s.id, s.name]));
    const byStream = new Map<
        string,
        {
            deviceId: number;
            kind: string;
            source: string;
            channel: number | null;
            buckets: Set<string>;
            readings: number;
            lastTs: string | null;
        }
    >();
    for (const r of history) {
        const key = `${r.deviceId}:${r.kind}:${r.source}:${r.channel ?? 'none'}`;
        const s = byStream.get(key) ?? {
            deviceId: r.deviceId,
            kind: r.kind,
            source: r.source,
            channel: r.channel,
            buckets: new Set<string>(),
            readings: 0,
            lastTs: null
        };
        s.buckets.add(r.bucket);
        s.readings += r.sampleCount;
        if (!s.lastTs || r.bucket > s.lastTs) s.lastTs = r.bucket;
        byStream.set(key, s);
    }
    const streams: EnvQualityStream[] = [...byStream.values()]
        .map((s) => {
            const buckets = s.buckets.size;
            return {
                deviceId: s.deviceId,
                name:
                    nameById.get(s.deviceId) ?? `Device ${s.deviceId}`,
                kind: s.kind,
                label: ENV_KIND_META[s.kind]?.label ?? s.kind,
                source: s.source,
                channel: s.channel,
                readings: s.readings,
                coveragePct: Math.min(
                    100,
                    Math.round((buckets / expected) * 100)
                ),
                buckets,
                expected,
                lastTs: s.lastTs
            };
        })
        .sort((a, b) => a.coveragePct - b.coveragePct);
    const overallPct = streams.length
        ? Math.round(
              streams.reduce((sum, s) => sum + s.coveragePct, 0) /
                  streams.length
          )
        : 0;
    return {
        overallPct,
        onlinePct: Math.round(onlinePct),
        expectedBuckets: expected,
        streams
    };
}

// ── Section builders ──

function buildKpis(
    input: EnvironmentDashboardInput,
    comfort: number | null
): DashKpiMetric[] {
    const avgTemp = avgOfReadings(input.live.temperature);
    const avgHum = avgOfReadings(input.live.humidity);
    const online = input.sensors.filter((s) => s.online).length;
    return [
        {
            key: 'temp',
            label: 'Avg temperature',
            value: round(avgTemp),
            unit: '°C',
            decimals: 1,
            live: true
        },
        {
            key: 'humidity',
            label: 'Avg humidity',
            value: round(avgHum),
            unit: '%',
            decimals: 1,
            live: true
        },
        {
            key: 'comfort',
            label: 'Comfort score',
            value: comfort == null ? null : Math.round(comfort),
            unit: '%',
            decimals: 0,
            threshold: {warning: 60, danger: 40}
        },
        {
            key: 'sensors',
            label: 'Sensors online',
            value: input.sensors.length ? online : null,
            decimals: 0,
            live: true
        }
    ];
}

function comfortLabelFor(
    temp: number | null,
    hum: number | null,
    s: EnvSettings
): string {
    if (temp == null || hum == null) return 'No data';
    const tempOk = temp >= s.tempComfortMin && temp <= s.tempComfortMax;
    const humOk = hum >= s.humidityComfortMin && hum <= s.humidityComfortMax;
    if (tempOk && humOk) return 'Comfortable';
    if (!tempOk) return temp < s.tempComfortMin ? 'Too cold' : 'Too warm';
    return hum < s.humidityComfortMin ? 'Too dry' : 'Too humid';
}

function buildInsights(
    input: EnvironmentDashboardInput,
    air: AirBand | null
): DashInsight[] {
    const list: DashInsight[] = [];
    const s = input.settings;
    const temps = input.live.temperature.map((r) => r.value);
    const hums = input.live.humidity.map((r) => r.value);
    if (temps.some((t) => t > s.tempComfortMax + 8))
        list.push({
            key: 'temp-high',
            color: 'danger',
            text: 'Temperature well above the comfort band on one or more sensors'
        });
    if (temps.some((t) => t < s.tempComfortMin - 10))
        list.push({
            key: 'temp-low',
            color: 'warning',
            text: 'Temperature well below the comfort band on one or more sensors'
        });
    if (hums.some((h) => h > s.moldHumidityThreshold))
        list.push({
            key: 'mold',
            color: 'warning',
            text: `Humidity above ${s.moldHumidityThreshold}% — mold risk`
        });
    if (air === 'poor')
        list.push({
            key: 'air-poor',
            color: 'danger',
            text: 'Air quality is poor for the selected sensors'
        });
    const offline = input.sensors.filter((x) => !x.online).length;
    if (offline)
        list.push({
            key: 'offline',
            color: 'blue',
            text: `${offline} sensor${offline > 1 ? 's' : ''} offline`
        });
    return list;
}

function buildSensorRows(input: EnvironmentDashboardInput): EnvSensorRow[] {
    const latest = (readings: EnvLiveReading[]) => {
        const map = new Map<number, number>();
        for (const r of readings)
            if (!map.has(r.deviceId)) map.set(r.deviceId, r.value);
        return map;
    };
    const tempMap = latest(input.live.temperature);
    const humMap = latest(input.live.humidity);
    const lumMap = latest(input.live.luminance);
    return input.sensors.map((s) => ({
        id: s.id,
        shellyId: s.shellyId,
        name: s.name,
        online: s.online,
        type: 'sensor' as const,
        source: s.source,
        battery: s.battery,
        temperature: tempMap.get(s.id) ?? null,
        humidity: humMap.get(s.id) ?? null,
        luminance: lumMap.get(s.id) ?? null
    }));
}

function visibleTabs(input: EnvironmentDashboardInput): EnvTabKey[] {
    const kinds = new Set(input.history.map((r) => r.kind));
    const eventKinds = new Set(input.events.map((e) => e.kind));
    const tabs: EnvTabKey[] = ['overview', 'comfort'];
    if (ENV_AIR_KINDS.some((k) => kinds.has(k))) tabs.push('air');
    tabs.push('light');
    if (ENV_WEATHER_KINDS.some((k) => kinds.has(k))) tabs.push('weather');
    if (ENV_PRESENCE_KINDS.some((k) => eventKinds.has(k)))
        tabs.push('presence');
    if (ENV_SAFETY_KINDS.some((k) => eventKinds.has(k))) tabs.push('safety');
    tabs.push('sensors');
    // Data quality assesses numeric coverage — only when there is history.
    if (input.history.length) tabs.push('quality');
    return tabs;
}

// ── Root builder ──

export function buildEnvironmentDashboardData(
    input: EnvironmentDashboardInput
): EnvironmentDashboardData {
    const s = input.settings;
    const temperature = kindBlock(input.history, 'temperature');
    const humidity = kindBlock(input.history, 'humidity');

    const comfort = comfortScore(temperature.series, humidity.series, s);
    const air = optionalKindBlock(input.history, 'co2');
    const pm25 = optionalKindBlock(input.history, 'pm25');
    const airBand = airQualityBand(air?.avg ?? null, pm25?.avg ?? null, s);

    const illuminance = optionalKindBlock(input.history, 'illuminance');
    const luxSeries = illuminance?.series ?? [];
    const dayLight = luxSeries.length
        ? daylightHours(
              luxSeries,
              s.daylightLux,
              bucketHoursFor(input.meta.granularity),
              daySpan(input.meta.from, input.meta.to)
          )
        : null;

    const avgTemp = avgOfReadings(input.live.temperature);
    const avgHum = avgOfReadings(input.live.humidity);
    const reported = new Set(
        [
            ...input.live.temperature,
            ...input.live.humidity,
            ...input.live.luminance
        ].map((r) => r.deviceId)
    ).size;
    const dataQualityPct = input.sensors.length
        ? (reported / input.sensors.length) * 100
        : 0;

    const bucketH = bucketHoursFor(input.meta.granularity);
    const tempInBand = temperature.series.filter(
        (p) => p.value >= s.tempComfortMin && p.value <= s.tempComfortMax
    ).length;

    const comfortSection: EnvComfort = {
        temperature,
        humidity,
        feelsLike:
            avgTemp != null && avgHum != null
                ? round(heatIndexC(avgTemp, avgHum))
                : null,
        dewPoint:
            avgTemp != null && avgHum != null
                ? round(dewPointC(avgTemp, avgHum))
                : null,
        comfortScore: comfort == null ? null : Math.round(comfort),
        hoursInBand: Math.round(tempInBand * bucketH),
        moldRisk: input.live.humidity.some(
            (h) => h.value > s.moldHumidityThreshold
        ),
        rhythm: HOURLY_OR_FINER.has(input.meta.granularity)
            ? weekdayHourRhythm(
                  input.history.filter((r) => r.kind === 'temperature')
              )
            : []
    };

    const airSection: EnvAir = {
        co2: air,
        tvoc: optionalKindBlock(input.history, 'tvoc'),
        pm25,
        pm10: optionalKindBlock(input.history, 'pm10'),
        band: airBand
    };

    const lightSection: EnvLight = {
        illuminance,
        uv: optionalKindBlock(input.history, 'uv'),
        daylightHours: dayLight == null ? null : round(dayLight)
    };

    const weatherSection: EnvWeather = {
        pressure: optionalKindBlock(input.history, 'pressure'),
        wind: optionalKindBlock(input.history, 'wind_speed'),
        rain: optionalKindBlock(input.history, 'precipitation')
    };

    const overview: EnvOverview = {
        kpis: buildKpis(input, comfort),
        temperature: temperature.series,
        humidity: humidity.series,
        comfortScore: comfort == null ? null : Math.round(comfort),
        comfortLabel: comfortLabelFor(avgTemp, avgHum, s),
        insights: buildInsights(input, airBand)
    };

    return {
        meta: {...input.meta, dataQualityPct: round(dataQualityPct, 0) ?? 0},
        config: {tabs: visibleTabs(input), settings: s},
        overview,
        comfort: comfortSection,
        air: airSection,
        light: lightSection,
        weather: weatherSection,
        presence: buildPresence(input.events, input.meta.granularity),
        safety: buildSafety(input.events),
        quality: buildQuality(
            input.history,
            input.sensors,
            input.meta,
            dataQualityPct
        ),
        sensors: buildSensorRows(input)
    };
}

// Pure composition of the environment report's section-tagged rows. Takes the
// sensor readings (plus optional bands/thresholds and a sensor-label resolver)
// and returns the full row array the CSV writer and HTML renderer consume. No
// I/O — all numbers come from environmentReportStats, so the whole thing is
// unit-testable from a fixture. Section order here is the report's section order.

import type {EnvironmentReportSectionId} from '../../types/api/report';
import {
    type EnvironmentReportRow,
    envRow,
    envRowBlank
} from './environmentReportRow';
import {
    type ActivityStat,
    AIR_QUALITY_KINDS,
    aggregateByKind,
    aggregateBySensor,
    aggregatePresence,
    aggregateSafety,
    type BreachStat,
    COMFORT_KINDS,
    type ComfortBands,
    comfortInBandPct,
    completenessByKind,
    countThresholdBreaches,
    DEFAULT_COMFORT_BANDS,
    DEFAULT_THRESHOLDS,
    ENVIRONMENT_UNITS,
    type EnvironmentEvent,
    type EnvironmentReading,
    expectedBucketCount,
    type KindStat,
    type KindThreshold,
    kindInBandPct,
    LIGHT_KINDS,
    type SafetySensorStat,
    WEATHER_KINDS
} from './environmentReportStats';

export interface ComposeEnvironmentInput {
    readings: readonly EnvironmentReading[];
    /** Discrete events feeding the presence + safety sections. */
    events?: readonly EnvironmentEvent[];
    from: Date;
    to: Date;
    bucket: string;
    /** Devices in scope — the "sensors" KPI headline. */
    sensorCount: number;
    comfortBands?: ComfortBands;
    thresholds?: Readonly<Record<string, KindThreshold>>;
    /** Display name for a sensor row; defaults to shellyID (then #id). */
    sensorLabel?: (row: {shellyID: string | null; device: number}) => string;
    /** Optional-section allowlist. Empty/omitted renders every data-present
     *  section; summary + comfort are core and always render. */
    sectionsEnabled?: readonly EnvironmentReportSectionId[];
}

// Round to 2 dp for display; keeps report numbers stable and comparable.
function r2(n: number): number {
    return Number(n.toFixed(2));
}

function unitOf(kind: string): string {
    return ENVIRONMENT_UNITS[kind] ?? '';
}

// "2026-07-11T21:00:00.000Z" -> "2026-07-11 21:00 UTC". Falls back to the raw
// value for any non-ISO string so an odd timestamp is never silently dropped.
function tsLabel(ts: string): string {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(ts);
    return m ? `${m[1]} ${m[2]} UTC` : ts;
}

export function composeEnvironmentReportRows(
    input: ComposeEnvironmentInput
): EnvironmentReportRow[] {
    const bands = input.comfortBands ?? DEFAULT_COMFORT_BANDS;
    const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
    const byKind = aggregateByKind(input.readings);
    const breaches = countThresholdBreaches(input.readings, thresholds);
    const events = input.events ?? [];
    const presence = aggregatePresence(events);
    const safety = aggregateSafety(events);
    const activeAlarms = safety.filter((s) => s.status === 'alarm').length;

    // Optional-section allowlist: empty/omitted keeps every section.
    const allow = input.sectionsEnabled;
    const on = (id: EnvironmentReportSectionId) =>
        !allow || allow.length === 0 || allow.includes(id);

    const rows: EnvironmentReportRow[] = [];
    appendSummary(rows, input, byKind, bands, safety, activeAlarms);
    appendComfort(rows, input, byKind, bands);
    if (on('air'))
        appendKindGroup(rows, 'AIR QUALITY', AIR_QUALITY_KINDS, byKind);
    if (on('light')) appendKindGroup(rows, 'LIGHT', LIGHT_KINDS, byKind);
    if (on('weather')) appendKindGroup(rows, 'WEATHER', WEATHER_KINDS, byKind);
    if (on('presence')) appendPresence(rows, presence);
    if (on('safety')) appendSafety(rows, safety, input);
    if (on('per_sensor')) appendPerSensor(rows, input);
    if (on('breaches')) appendBreaches(rows, breaches);
    if (on('recommendations'))
        appendRecommendations(
            rows,
            input,
            byKind,
            bands,
            breaches,
            activeAlarms
        );
    if (on('data_quality')) appendDataQuality(rows, input);
    return rows;
}

// Fleet headline rows — the HTML KPI cards read these by `kind`.
function appendSummary(
    rows: EnvironmentReportRow[],
    input: ComposeEnvironmentInput,
    byKind: Map<string, KindStat>,
    bands: ComfortBands,
    safety: readonly SafetySensorStat[],
    activeAlarms: number
): void {
    const temp = byKind.get('temperature');
    const hum = byKind.get('humidity');
    if (temp) rows.push(fleetKindRow('temperature', temp));
    if (hum) rows.push(fleetKindRow('humidity', hum));

    const comfort = comfortInBandPct(input.readings, bands);
    if (comfort.pct !== null) {
        rows.push(
            envRow({
                section: 'SUMMARY',
                kind: 'comfort',
                sensor: 'Fleet',
                in_band_pct: r2(comfort.pct),
                notes: `temperature ${bands.tempMinC}-${bands.tempMaxC} °C, humidity ${bands.humidityMinPct}-${bands.humidityMaxPct} % (${comfort.inBand}/${comfort.buckets} buckets)`
            })
        );
    }
    rows.push(
        envRow({
            section: 'SUMMARY',
            kind: 'sensors',
            sensor: 'Fleet',
            samples: input.sensorCount,
            notes: 'sensors in scope'
        })
    );
    // Alarms headline only when safety sensors reported — drives the KPI card.
    if (safety.length > 0) {
        rows.push(
            envRow({
                section: 'SUMMARY',
                kind: 'alarms',
                sensor: 'Fleet',
                samples: activeAlarms,
                notes: `active safety alarms (${safety.length} sensors monitored)`
            })
        );
    }
    rows.push(envRowBlank());
}

function fleetKindRow(kind: string, stat: KindStat): EnvironmentReportRow {
    return envRow({
        section: 'SUMMARY',
        kind,
        sensor: 'Fleet',
        unit: unitOf(kind),
        avg: r2(stat.avg),
        min: r2(stat.min),
        max: r2(stat.max),
        samples: stat.samples
    });
}

// Temperature + humidity in-band detail, dew point, and the combined comfort
// score. Rendered whenever any comfort kind has data.
function appendComfort(
    rows: EnvironmentReportRow[],
    input: ComposeEnvironmentInput,
    byKind: Map<string, KindStat>,
    bands: ComfortBands
): void {
    if (!COMFORT_KINDS.some((kind) => byKind.has(kind))) return;
    rows.push(header('COMFORT'));

    const temp = byKind.get('temperature');
    if (temp) {
        const band = kindInBandPct(
            input.readings,
            'temperature',
            bands.tempMinC,
            bands.tempMaxC
        );
        rows.push(
            kindStatRow('temperature', temp, {
                in_band_pct: band.pct === null ? '' : r2(band.pct),
                notes: `comfort band ${bands.tempMinC}-${bands.tempMaxC} °C`
            })
        );
    }
    const hum = byKind.get('humidity');
    if (hum) {
        const band = kindInBandPct(
            input.readings,
            'humidity',
            bands.humidityMinPct,
            bands.humidityMaxPct
        );
        rows.push(
            kindStatRow('humidity', hum, {
                in_band_pct: band.pct === null ? '' : r2(band.pct),
                notes: `comfort band ${bands.humidityMinPct}-${bands.humidityMaxPct} %`
            })
        );
    }
    const dew = byKind.get('dewpoint');
    if (dew) rows.push(kindStatRow('dewpoint', dew));

    const comfort = comfortInBandPct(input.readings, bands);
    if (comfort.pct !== null) {
        rows.push(
            envRow({
                kind: 'comfort',
                sensor: 'Fleet',
                in_band_pct: r2(comfort.pct),
                notes: 'temperature and humidity both in band'
            })
        );
    }
    rows.push(envRowBlank());
}

// A whole section of per-kind avg/min/max rows, rendered only when at least one
// of the section's kinds carries data (mirrors energy gating Solar/Battery).
function appendKindGroup(
    rows: EnvironmentReportRow[],
    title: string,
    kinds: readonly string[],
    byKind: Map<string, KindStat>
): void {
    const present = kinds.filter((kind) => byKind.has(kind));
    if (present.length === 0) return;
    rows.push(header(title));
    for (const kind of present) {
        const stat = byKind.get(kind);
        if (stat) rows.push(kindStatRow(kind, stat));
    }
    rows.push(envRowBlank());
}

// Fleet activity counts per event kind. Rendered only when presence events
// exist, mirroring the dashboard's Presence & Activity tab.
function appendPresence(
    rows: EnvironmentReportRow[],
    presence: readonly ActivityStat[]
): void {
    if (presence.length === 0) return;
    rows.push(header('PRESENCE & ACTIVITY'));
    for (const p of presence) {
        rows.push(
            envRow({
                kind: p.label,
                sensor: 'Fleet',
                samples: p.count,
                notes: p.lastTs ? `last ${tsLabel(p.lastTs)}` : 'no events'
            })
        );
    }
    rows.push(envRowBlank());
}

// Per-sensor safety status from the latest event of each stream. Alarm streams
// sort first (aggregateSafety). Rendered only when safety events exist.
function appendSafety(
    rows: EnvironmentReportRow[],
    safety: readonly SafetySensorStat[],
    input: ComposeEnvironmentInput
): void {
    if (safety.length === 0) return;
    const label =
        input.sensorLabel ??
        ((row: {shellyID: string | null; device: number}) =>
            row.shellyID ?? `#${row.device}`);
    rows.push(header('SAFETY'));
    for (const s of safety) {
        const when = s.lastTs ? ` · last ${tsLabel(s.lastTs)}` : '';
        rows.push(
            envRow({
                kind: s.label,
                sensor: label({shellyID: s.shellyID, device: s.device}),
                breaches: s.alarms,
                notes: `${s.status === 'alarm' ? 'ALARM' : 'clear'}${when}`
            })
        );
    }
    rows.push(envRowBlank());
}

// Per-(sensor, kind) breakdown. Empty when there are no readings.
function appendPerSensor(
    rows: EnvironmentReportRow[],
    input: ComposeEnvironmentInput
): void {
    const perSensor = aggregateBySensor(input.readings);
    if (perSensor.length === 0) return;
    const label =
        input.sensorLabel ??
        ((row: {shellyID: string | null; device: number}) =>
            row.shellyID ?? `#${row.device}`);
    rows.push(header('PER-SENSOR'));
    for (const s of perSensor) {
        rows.push(
            envRow({
                kind: s.kind,
                sensor: label({shellyID: s.shellyID, device: s.device}),
                source:
                    s.channel == null
                        ? s.source
                        : `${s.source} · channel ${s.channel}`,
                unit: unitOf(s.kind),
                avg: r2(s.avg),
                min: r2(s.min),
                max: r2(s.max),
                samples: s.samples
            })
        );
    }
    rows.push(envRowBlank());
}

// Threshold breaches — only kinds that actually broke their band are listed.
function appendBreaches(
    rows: EnvironmentReportRow[],
    breaches: readonly BreachStat[]
): void {
    const fired = breaches.filter((b) => b.breaches > 0);
    if (fired.length === 0) return;
    rows.push(header('THRESHOLD BREACHES'));
    for (const b of fired) {
        rows.push(
            envRow({
                kind: b.kind,
                sensor: 'Fleet',
                breaches: b.breaches,
                samples: b.total,
                notes: `${b.label} — ${b.breaches} of ${b.total} buckets`
            })
        );
    }
    rows.push(envRowBlank());
}

// Data-driven advice from the comfort score and the breach counts.
function appendRecommendations(
    rows: EnvironmentReportRow[],
    input: ComposeEnvironmentInput,
    byKind: Map<string, KindStat>,
    bands: ComfortBands,
    breaches: readonly BreachStat[],
    activeAlarms: number
): void {
    const notes: string[] = [];
    // Safety leads — an active alarm outranks any comfort advice.
    if (activeAlarms > 0) {
        notes.push(
            `${activeAlarms} safety sensor${activeAlarms > 1 ? 's' : ''} currently in alarm — investigate immediately`
        );
    }
    const comfort = comfortInBandPct(input.readings, bands);
    if (comfort.pct !== null && comfort.pct < 80) {
        notes.push(
            `Comfort out of band ${r2(100 - comfort.pct)}% of the time — review heating/cooling setpoints`
        );
    }
    if (breachCount(breaches, 'co2') > 0) {
        notes.push('CO₂ repeatedly elevated — improve ventilation');
    }
    const hum = byKind.get('humidity');
    if (hum && hum.max > 70) {
        notes.push(
            `Humidity peaked at ${r2(hum.max)}% — sustained high humidity risks mold`
        );
    }
    if (breachCount(breaches, 'pm25') > 0) {
        notes.push(
            'PM2.5 above the WHO guideline — check filtration / sources'
        );
    }
    if (notes.length === 0) return;
    rows.push(header('RECOMMENDATIONS'));
    for (const note of notes)
        rows.push(envRow({sensor: 'Advice', notes: note}));
    rows.push(envRowBlank());
}

function breachCount(breaches: readonly BreachStat[], kind: string): number {
    return breaches.find((b) => b.kind === kind)?.breaches ?? 0;
}

// Coverage per kind: distinct buckets present vs expected for the window.
function appendDataQuality(
    rows: EnvironmentReportRow[],
    input: ComposeEnvironmentInput
): void {
    const expected = expectedBucketCount(input.from, input.to, input.bucket);
    const coverage = completenessByKind(input.readings, expected);
    if (coverage.length === 0) return;
    rows.push(header('DATA QUALITY'));
    for (const c of coverage) {
        rows.push(
            envRow({
                kind: c.kind,
                sensor: 'Fleet',
                samples: c.distinctBuckets,
                in_band_pct: r2(c.completenessPct),
                notes: `${c.distinctBuckets} of ${c.expectedBuckets} expected buckets`
            })
        );
    }
    rows.push(envRowBlank());
}

function header(title: string): EnvironmentReportRow {
    return envRow({section: title});
}

function kindStatRow(
    kind: string,
    stat: KindStat,
    extra: Partial<EnvironmentReportRow> = {}
): EnvironmentReportRow {
    return envRow({
        kind,
        unit: unitOf(kind),
        avg: r2(stat.avg),
        min: r2(stat.min),
        max: r2(stat.max),
        samples: stat.samples,
        ...extra
    });
}

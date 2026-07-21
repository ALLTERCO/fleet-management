<template>
    <div ref="rootEl" class="evolt">
        <!-- Toolbar: tabs left, tools right (same shell as the energy dashboard) -->
        <div class="toolbar">
            <div class="seg" role="tablist">
                <button
                    v-for="tab in d.config.tabs"
                    :key="tab"
                    type="button"
                    role="tab"
                    :class="{on: activeTab === tab}"
                    @click="activeTab = tab"
                >
                    {{ TAB_LABEL[tab] }}
                </button>
            </div>
            <DashVoltaineTools
                :range-label="rangeLabel"
                :refresh-interval="refreshInterval"
                show-filter
                show-interval
                @pick-range="emit('pick-range', $event)"
                @open-filter="emit('open-filter')"
                @refresh="emit('refresh')"
                @set-interval="emit('set-interval', $event)"
                @open-settings="settingsOpen = true"
                @open-report="reportOpen = true"
            />
        </div>

        <!-- OVERVIEW. v-if (not display:none) so ECharts mounts at real size. -->
        <section v-if="activeTab === 'overview'" class="on">
            <div class="grid g4">
                <div
                    v-for="(k, i) in d.overview.kpis"
                    :key="k.key"
                    class="card ctr"
                    :style="{'--i': i}"
                >
                    <div class="lab">{{ k.label }}</div>
                    <div class="kpi" :style="k.key === 'comfort' ? {color: comfortColor} : undefined">
                        <span>{{ k.value ?? '—' }}</span><small v-if="k.unit">{{ k.unit }}</small>
                    </div>
                </div>
            </div>

            <div class="grid g32 mt">
                <div class="card pad0 hero" style="--i: 4">
                    <div class="head">
                        <h3>Temperature &amp; humidity</h3>
                        <div class="legend">
                            <i><span class="dot" :style="{background: colorFor('temperature')}" />Temp</i>
                            <i><span class="dot" :style="{background: colorFor('humidity')}" />Humidity</i>
                        </div>
                    </div>
                    <div style="padding: 4px 14px 14px">
                        <DashTimeChart
                            :data="d.overview.temperature"
                            :secondary-data="d.overview.humidity"
                            secondary-label="Humidity"
                            :secondary-color="colorFor('humidity')"
                            type="area"
                            :color="colorFor('temperature')"
                            unit="°C"
                            :height="230"
                            :mark-area="tempComfortBand"
                            :loading="loading"
                            zoom
                        />
                    </div>
                </div>
                <div class="grid" style="grid-template-columns: 1fr; gap: 12px">
                    <div class="card ctr" style="--i: 5">
                        <div class="lab">Comfort score</div>
                        <div class="kpi" :style="{color: comfortColor}">
                            <span>{{ d.overview.comfortScore ?? '—' }}</span><small>%</small>
                        </div>
                        <div class="sub">{{ d.overview.comfortLabel }}</div>
                    </div>
                    <div class="card ctr" style="--i: 6">
                        <div class="lab">Data quality</div>
                        <div class="kpi"><span>{{ d.meta.dataQualityPct }}</span><small>%</small></div>
                        <div class="sub">sensors reporting</div>
                    </div>
                </div>
            </div>

            <div v-if="d.overview.insights.length" class="card" style="--i: 7">
                <div class="head" style="margin-bottom: 6px"><h3>Insights</h3></div>
                <div class="rows">
                    <div v-for="ins in d.overview.insights" :key="ins.key" class="row">
                        <span><span class="dot" :style="{background: insightColor(ins.color)}" /> {{ ins.text }}</span>
                    </div>
                </div>
            </div>
        </section>

        <!-- COMFORT -->
        <section v-if="activeTab === 'comfort'" class="on">
            <div class="grid g4">
                <StatCard label="Feels like" :value="d.comfort.feelsLike" unit="°C" />
                <StatCard label="Dew point" :value="d.comfort.dewPoint" unit="°C" />
                <StatCard label="Hours in band" :value="d.comfort.hoursInBand" unit="h" :decimals="0" />
                <div class="card ctr">
                    <div class="lab">Mold risk</div>
                    <div class="kpi" :style="{color: d.comfort.moldRisk ? 'var(--orange)' : 'var(--green)'}">
                        <span>{{ d.comfort.moldRisk ? 'Yes' : 'No' }}</span>
                    </div>
                    <div class="sub">humidity threshold</div>
                </div>
            </div>
            <div class="grid g2">
                <ChartCard :block="d.comfort.temperature" :color="colorFor('temperature')" :mark-area="tempComfortBand" :loading="loading" />
                <ChartCard :block="d.comfort.humidity" :color="colorFor('humidity')" :mark-area="humidityComfortBand" :loading="loading" />
            </div>
            <div v-if="rhythmData.length" class="card">
                <div class="head" style="margin-bottom: 6px"><h3>Weekday rhythm</h3><span class="meta">avg temperature</span></div>
                <DashHeatmap :data="rhythmData" :max="rhythmMax" unit="°C" :loading="loading" />
            </div>
        </section>

        <!-- AIR QUALITY -->
        <section v-if="activeTab === 'air'" class="on">
            <div class="grid g4">
                <div class="card ctr">
                    <div class="lab">Air quality</div>
                    <div class="kpi" :style="{color: airBandColor}"><span>{{ airBandLabel }}</span></div>
                    <div class="sub">worst of CO₂ and PM2.5</div>
                </div>
                <StatCard v-if="d.air.co2" label="Avg CO₂" :value="d.air.co2.avg" unit="ppm" :decimals="0" />
                <StatCard v-if="d.air.pm25" label="Avg PM2.5" :value="d.air.pm25.avg" unit="µg/m³" />
                <StatCard v-if="d.air.tvoc" label="Avg TVOC" :value="d.air.tvoc.avg" unit="ppb" :decimals="0" />
            </div>
            <div class="grid g2">
                <ChartCard
                    v-for="block in airBlocks"
                    :key="block.kind"
                    :block="block"
                    :color="colorFor(block.kind)"
                    :loading="loading"
                />
            </div>
        </section>

        <!-- LIGHT -->
        <section v-if="activeTab === 'light'" class="on">
            <div class="grid g4">
                <StatCard v-if="d.light.illuminance" label="Avg light" :value="d.light.illuminance.avg" unit="lux" :decimals="0" />
                <StatCard v-if="d.light.daylightHours != null" label="Daylight" :value="d.light.daylightHours" unit="h/day" />
                <StatCard v-if="d.light.uv" label="Avg UV" :value="d.light.uv.avg" unit="" />
            </div>
            <div class="grid g2">
                <ChartCard v-if="d.light.illuminance" :block="d.light.illuminance" :color="colorFor('illuminance')" :loading="loading" />
                <ChartCard v-if="d.light.uv" :block="d.light.uv" :color="colorFor('uv')" :loading="loading" />
            </div>
        </section>

        <!-- WEATHER -->
        <section v-if="activeTab === 'weather'" class="on">
            <div class="grid g2">
                <ChartCard
                    v-for="block in weatherBlocks"
                    :key="block.kind"
                    :block="block"
                    :color="colorFor(block.kind)"
                    :loading="loading"
                />
            </div>
        </section>

        <!-- SENSORS -->
        <section v-if="activeTab === 'sensors'" class="on">
            <div class="card pad0">
                <table>
                    <thead>
                        <tr>
                            <th>Sensor</th>
                            <th>Source</th>
                            <th class="r">Temp</th>
                            <th class="r">Humidity</th>
                            <th class="r">Battery</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="s in d.sensors" :key="s.id">
                            <td>{{ s.name }}</td>
                            <td class="mut">{{ s.source }}</td>
                            <td class="r">{{ s.temperature != null ? `${s.temperature.toFixed(1)}°C` : '—' }}</td>
                            <td class="r">{{ s.humidity != null ? `${s.humidity.toFixed(0)}%` : '—' }}</td>
                            <td class="r">{{ s.battery != null ? `${s.battery}%` : '—' }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <!-- PRESENCE & ACTIVITY -->
        <section v-if="activeTab === 'presence'" class="on">
            <div class="grid g4">
                <StatCard label="Total events" :value="d.presence.totalEvents" :decimals="0" />
                <div class="card ctr">
                    <div class="lab">Busiest hour</div>
                    <div class="kpi"><span>{{ busiestHourLabel }}</span></div>
                    <div class="sub">most activity</div>
                </div>
                <StatCard label="Activity types" :value="d.presence.kinds.length" :decimals="0" />
            </div>
            <div v-if="d.presence.timeline.length" class="card pad0 hero">
                <div class="head"><h3>Activity over time</h3></div>
                <div style="padding: 4px 14px 14px">
                    <DashTimeChart
                        :data="d.presence.timeline"
                        type="bar"
                        :color="colorFor('humidity')"
                        unit="events"
                        :height="230"
                        :loading="loading"
                    />
                </div>
            </div>
            <div class="card pad0">
                <table>
                    <thead>
                        <tr><th>Activity</th><th class="r">Events</th><th class="r">Last seen</th></tr>
                    </thead>
                    <tbody>
                        <tr v-for="k in d.presence.kinds" :key="k.kind">
                            <td>{{ k.label }}</td>
                            <td class="r">{{ k.count }}</td>
                            <td class="r mut">{{ fmtTs(k.lastTs) }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <!-- SAFETY -->
        <section v-if="activeTab === 'safety'" class="on">
            <div class="grid g4">
                <div class="card ctr">
                    <div class="lab">Active alarms</div>
                    <div
                        class="kpi"
                        :style="{color: d.safety.alarmsActive ? 'var(--red)' : 'var(--green)'}"
                    >
                        <span>{{ d.safety.alarmsActive }}</span>
                    </div>
                    <div class="sub">{{ d.safety.alarmsActive ? 'attention needed' : 'all clear' }}</div>
                </div>
                <StatCard label="Sensors monitored" :value="d.safety.sensors.length" :decimals="0" />
                <StatCard label="Alarms in range" :value="d.safety.alarmsTotal" :decimals="0" />
            </div>
            <div class="card pad0">
                <table>
                    <thead>
                        <tr><th>Sensor</th><th>Type</th><th>Status</th><th class="r">Last event</th></tr>
                    </thead>
                    <tbody>
                        <tr v-for="s in d.safety.sensors" :key="`${s.deviceId}-${s.kind}`">
                            <td>{{ s.name }}</td>
                            <td class="mut">{{ s.label }}</td>
                            <td>
                                <span class="pill" :style="safetyPill(s.status)">
                                    {{ safetyLabel(s.status) }}
                                </span>
                            </td>
                            <td class="r mut">{{ fmtTs(s.lastTs) }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <!-- DATA QUALITY -->
        <section v-if="activeTab === 'quality'" class="on">
            <div class="grid g4">
                <StatCard label="Overall coverage" :value="d.quality.overallPct" unit="%" :decimals="0" />
                <StatCard label="Sensors reporting" :value="d.quality.onlinePct" unit="%" :decimals="0" />
                <StatCard label="Data streams" :value="d.quality.streams.length" :decimals="0" />
                <StatCard label="Expected buckets" :value="d.quality.expectedBuckets" :decimals="0" />
            </div>
            <div class="card pad0">
                <table>
                    <thead>
                        <tr>
                            <th>Sensor</th><th>Reading</th><th>Source</th>
                            <th class="r">Channel</th><th class="r">Readings</th>
                            <th class="r">Coverage</th><th class="r">Buckets</th><th class="r">Last seen</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="s in d.quality.streams"
                            :key="`${s.deviceId}-${s.kind}-${s.source}-${s.channel ?? 'none'}`"
                        >
                            <td>{{ s.name }}</td>
                            <td class="mut">{{ s.label }}</td>
                            <td class="mut">{{ s.source }}</td>
                            <td class="r mut">{{ s.channel ?? '—' }}</td>
                            <td class="r mut">{{ s.readings }}</td>
                            <td class="r" :style="{color: coverageColor(s.coveragePct)}">{{ s.coveragePct }}%</td>
                            <td class="r mut">{{ s.buckets }}/{{ s.expected }}</td>
                            <td class="r mut">{{ fmtTs(s.lastTs) }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <!-- Report modal — same placement as the energy dashboard -->
        <div class="mov" :class="{on: reportOpen}" @click.self="reportOpen = false">
            <div class="modal rep-modal">
                <div class="mhd">
                    <div>
                        <h3>Download report</h3>
                        <p class="msub">{{ d.meta.scopeName }} · environment</p>
                    </div>
                    <button type="button" class="mx" @click="reportOpen = false">✕</button>
                </div>
                <div class="mpanel">
                    <div class="field">
                        <div class="fl">Detail level</div>
                        <div class="seg2">
                            <button
                                v-for="g in REPORT_GRANS"
                                :key="g.key"
                                type="button"
                                :class="{on: reportGranularity === g.key}"
                                @click="reportGranularity = g.key"
                            >
                                {{ g.label }}
                            </button>
                        </div>
                    </div>
                    <div class="field">
                        <div class="fl">Format</div>
                        <div class="seg2">
                            <button
                                v-for="f in REPORT_FORMATS"
                                :key="f.key"
                                type="button"
                                :class="{on: reportFormat === f.key}"
                                @click="reportFormat = f.key"
                            >
                                {{ f.label }}
                            </button>
                        </div>
                    </div>
                    <div class="field">
                        <div class="fl">Reading source</div>
                        <div class="seg2">
                            <button
                                v-for="s in REPORT_SOURCES"
                                :key="s.key"
                                type="button"
                                :class="{on: reportSource === s.key}"
                                @click="reportSource = s.key"
                            >
                                {{ s.label }}
                            </button>
                        </div>
                    </div>
                    <div class="field">
                        <div class="fl">
                            Sections
                            <span class="rep-hint-inline">
                                · summary &amp; comfort always included
                            </span>
                        </div>
                        <div class="rep-chips">
                            <button
                                v-for="s in REPORT_SECTIONS"
                                :key="s.key"
                                type="button"
                                class="rep-chip"
                                :class="{on: reportSections[s.key]}"
                                @click="reportSections[s.key] = !reportSections[s.key]"
                            >
                                {{ s.label }}
                            </button>
                        </div>
                    </div>
                    <p class="rep-note">
                        Uses this dashboard's date range and scope.
                    </p>
                </div>
                <div class="mft">
                    <button type="button" class="btn-ghost" @click="reportOpen = false">
                        Cancel
                    </button>
                    <button type="button" class="btn-primary" @click="onGenerate">
                        Generate report
                    </button>
                </div>
            </div>
        </div>

        <EnvSettingsPanel
            :visible="settingsOpen"
            :settings="d.config.settings"
            @close="settingsOpen = false"
            @save="onSaveSettings"
        />
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, reactive, ref} from 'vue';
import DashHeatmap from '@/components/dashboard/DashHeatmap.vue';
import DashTimeChart from '@/components/dashboard/DashTimeChart.vue';
import DashVoltaineTools from '@/components/dashboard/DashVoltaineTools.vue';
import ChartCard from './EnvironmentChartCard.vue';
import StatCard from './EnvironmentStatCard.vue';
import EnvSettingsPanel from './EnvSettingsPanel.vue';
import type {
    EnvironmentDashboardData,
    EnvKindBlock,
    EnvSettings,
    EnvTabKey
} from './environmentDashboard.types';

const props = defineProps<{
    d: EnvironmentDashboardData;
    loading?: boolean;
    refreshInterval?: number;
}>();

const emit = defineEmits<{
    refresh: [];
    'open-filter': [];
    'pick-range': [range: {key: string; from?: string; to?: string}];
    'set-interval': [ms: number];
    'generate-report': [
        params: {
            format: string;
            granularity: string;
            source?: string;
            sections: string[];
        }
    ];
    'save-settings': [settings: EnvSettings];
}>();

const activeTab = ref<EnvTabKey>('overview');
const reportOpen = ref(false);
const reportFormat = ref('html');
const reportGranularity = ref('hour');
const reportSource = ref('all');
// Optional sections default on; summary + comfort are core and never listed.
const reportSections = reactive<Record<string, boolean>>({
    air: true,
    light: true,
    weather: true,
    presence: true,
    safety: true,
    per_sensor: true,
    breaches: true,
    recommendations: true,
    data_quality: true
});
const settingsOpen = ref(false);

// Date-range label for the shared toolbar chip; the page resolves the picked
// preset into concrete dates (DashVoltaineTools owns the picker itself).
function fmtDay(iso: string): string {
    const d = new Date(iso);
    return `${d.toLocaleString('en-US', {month: 'short', timeZone: 'UTC'})} ${d.getUTCDate()}`;
}
const rangeLabel = computed(() => {
    const {from, to} = props.d.meta;
    if (!from || !to) return 'Select range';
    return `${fmtDay(from)} – ${fmtDay(to)}, ${new Date(to).getUTCFullYear()}`;
});

const REPORT_GRANS = [
    {key: 'hour', label: 'Hourly'},
    {key: 'day', label: 'Daily'},
    {key: 'month', label: 'Monthly'}
] as const;
const REPORT_FORMATS = [
    {key: 'html', label: 'HTML report'},
    {key: 'csv', label: 'CSV data'}
] as const;
// 'all' = every ambient source (chip temps excluded server-side).
const REPORT_SOURCES = [
    {key: 'all', label: 'All'},
    {key: 'builtin', label: 'Built-in'},
    {key: 'addon', label: 'Add-on'},
    {key: 'blu', label: 'BLU'},
    {key: 'weather', label: 'Weather'}
] as const;
// Optional sections — must match ENVIRONMENT_REPORT_SECTION_IDS on the backend.
const REPORT_SECTIONS = [
    {key: 'air', label: 'Air quality'},
    {key: 'light', label: 'Light'},
    {key: 'weather', label: 'Weather'},
    {key: 'presence', label: 'Presence'},
    {key: 'safety', label: 'Safety'},
    {key: 'per_sensor', label: 'Per-sensor'},
    {key: 'breaches', label: 'Breaches'},
    {key: 'recommendations', label: 'Recommendations'},
    {key: 'data_quality', label: 'Data quality'}
] as const;

const TAB_LABEL: Record<EnvTabKey, string> = {
    overview: 'Overview',
    comfort: 'Comfort',
    air: 'Air Quality',
    light: 'Light',
    weather: 'Weather',
    presence: 'Presence',
    safety: 'Safety',
    sensors: 'Sensors',
    quality: 'Data Quality'
};

// Chart colours map each kind to a voltaine palette CSS var. The concrete hex
// are resolved from voltaine.css at runtime, so it stays the single source and
// re-tinting the stylesheet updates the charts too (no hex duplicated here).
const KIND_VAR: Record<string, string> = {
    temperature: '--red',
    humidity: '--blue',
    illuminance: '--yellow',
    co2: '--cyan',
    tvoc: '--orange',
    pm25: '--orange',
    pm10: '--yellow',
    pressure: '--green',
    dewpoint: '--cyan',
    uv: '--yellow',
    wind_speed: '--cyan',
    precipitation: '--blue'
};
const INSIGHT_VAR: Record<string, string> = {
    danger: '--red',
    warning: '--orange',
    success: '--green',
    blue: '--blue'
};

// Read the voltaine palette from CSS vars once mounted, so chart colours stay
// single-sourced in voltaine.css rather than duplicated as hex here.
const rootEl = ref<HTMLElement | null>(null);
const palette = ref<Record<string, string>>({});
onMounted(() => {
    if (!rootEl.value) return;
    const cs = getComputedStyle(rootEl.value);
    const out: Record<string, string> = {};
    for (const v of ['--red', '--blue', '--green', '--yellow', '--orange', '--cyan'])
        out[v] = cs.getPropertyValue(v).trim();
    palette.value = out;
});
function paletteColor(varName: string): string {
    return palette.value[varName] || '#0A84FF';
}
function colorFor(kind: string): string {
    return paletteColor(KIND_VAR[kind] ?? '--blue');
}
function insightColor(c: string): string {
    return paletteColor(INSIGHT_VAR[c] ?? '--blue');
}

const s = computed(() => props.d.config.settings);
const tempComfortBand = computed(() => ({
    min: s.value.tempComfortMin,
    max: s.value.tempComfortMax
}));
const humidityComfortBand = computed(() => ({
    min: s.value.humidityComfortMin,
    max: s.value.humidityComfortMax
}));

const comfortColor = computed(() => {
    const v = props.d.overview.comfortScore;
    if (v == null) return 'var(--ink)';
    if (v >= 70) return 'var(--green)';
    if (v >= 40) return 'var(--yellow)';
    return 'var(--red)';
});

const AIR_BAND_LABEL = {good: 'Good', fair: 'Fair', poor: 'Poor'} as const;
const airBandLabel = computed(() =>
    props.d.air.band ? AIR_BAND_LABEL[props.d.air.band] : '—'
);
const airBandColor = computed(() => {
    switch (props.d.air.band) {
        case 'good':
            return 'var(--green)';
        case 'fair':
            return 'var(--yellow)';
        case 'poor':
            return 'var(--red)';
        default:
            return 'var(--ink)';
    }
});

const airBlocks = computed(() =>
    [props.d.air.co2, props.d.air.tvoc, props.d.air.pm25, props.d.air.pm10].filter(
        (b): b is EnvKindBlock => b != null
    )
);
const weatherBlocks = computed(() =>
    [props.d.weather.pressure, props.d.weather.wind, props.d.weather.rain].filter(
        (b): b is EnvKindBlock => b != null
    )
);

// ── Presence / safety / data quality ──

const busiestHourLabel = computed(() => {
    const h = props.d.presence.busiestHour;
    return h == null ? '—' : `${String(h).padStart(2, '0')}:00`;
});

function fmtTs(ts: string | null): string {
    if (!ts) return '—';
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

const SAFETY_LABEL: Record<string, string> = {
    clear: 'Clear',
    alarm: 'Alarm',
    unknown: 'Unknown'
};
function safetyLabel(status: string): string {
    return SAFETY_LABEL[status] ?? status;
}
function safetyPill(status: string): Record<string, string> {
    const color =
        status === 'alarm'
            ? 'var(--red)'
            : status === 'clear'
              ? 'var(--green)'
              : 'var(--sub)';
    return {
        color,
        border: `1px solid ${color}`,
        borderRadius: '99px',
        padding: '2px 10px',
        fontSize: '12px'
    };
}

function coverageColor(pct: number): string {
    if (pct >= 90) return 'var(--green)';
    if (pct >= 60) return 'var(--yellow)';
    return 'var(--red)';
}

// Rhythm grid (7×24) into [hour, day, value] triples for DashHeatmap.
const rhythmData = computed((): [number, number, number][] => {
    const out: [number, number, number][] = [];
    const grid = props.d.comfort.rhythm;
    for (let day = 0; day < grid.length; day++) {
        const row = grid[day];
        for (let hour = 0; hour < row.length; hour++) {
            const value = row[hour];
            if (Number.isFinite(value))
                out.push([hour, day, Math.round(value * 10) / 10]);
        }
    }
    return out;
});
const rhythmMax = computed(() =>
    rhythmData.value.reduce((m, [, , v]) => Math.max(m, v), 0)
);

function onGenerate() {
    const sections = REPORT_SECTIONS.filter((s) => reportSections[s.key]).map(
        (s) => s.key
    );
    emit('generate-report', {
        format: reportFormat.value,
        granularity: reportGranularity.value,
        // 'all' means no source filter — let the backend default (ambient).
        source: reportSource.value === 'all' ? undefined : reportSource.value,
        sections
    });
    reportOpen.value = false;
}

function onSaveSettings(next: EnvSettings) {
    emit('save-settings', next);
    settingsOpen.value = false;
}
</script>

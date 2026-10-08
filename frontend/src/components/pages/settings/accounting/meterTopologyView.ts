// What the meter topology page shows: the vocabulary its labels are read
// from, the rows the queue, the counter list and the meaning history are
// shaped into, the UTC boundary its form accepts, and how one preview's
// impact reads. Pure functions only — the panel owns the loading, the
// selection and the writes.

import type {
    EnergyLogicalMeter,
    EnergyLogicalMeterMeaning,
    EnergyLogicalMeterMeaningChangeImpact,
    EnergyLogicalMeterMeaningReviewItem,
    EnergyLogicalMeterPoint,
    EnergyMeterRole,
    EnergyPreviewLogicalMeterMeaningChangeResponse,
    EnergyUtilityType
} from '@api/energy';
import type {KindEntry} from '@/api/kindRpc';
import {energyRolesForUtility} from '@/helpers/energyAssignment';

export type MeterFilter = 'review' | 'all';

/** The words one page state names meanings with. Roles are read from the
 *  utility of the meter under review, so every row shares that vocabulary. */
export interface MeterVocabulary {
    utilityType: EnergyUtilityType | null;
    kinds: KindEntry[];
}

/** How a physical device is named on screen. */
export interface MeterDeviceLabels {
    name: string;
    externalId: string;
}

export interface MeterListContext {
    reviews: Map<number, EnergyLogicalMeterMeaningReviewItem>;
    vocabulary: MeterVocabulary;
    describeDevice: (deviceId: number) => MeterDeviceLabels;
}

export interface MeterListRow {
    id: number;
    name: string;
    utility: string;
    role: string;
    kind: string;
    underReview: boolean;
    /** The evidence badge, on a meter under review only. */
    confidenceLabel: string | null;
    searchText: string;
}

/** One meaning revision as the history list reads it. */
export interface MeterRevisionRow {
    revision: number;
    role: string;
    kind: string;
    interval: string;
}

/** Which meters the queue shows: one segment, narrowed by one search box. */
export interface MeterListView {
    filter: MeterFilter;
    search: string;
}

export interface MeterListEmptyState {
    title: string;
    message: string;
}

export interface MeterKindGroup {
    label: string;
    items: KindEntry[];
}

export interface MeterPointRow {
    key: string;
    device: MeterDeviceLabels;
    counter: string;
    channel: number;
    measurement: string;
    direction: string;
}

export interface MeterImpactSurface {
    key: string;
    label: string;
    count: number;
    ids: number[];
    truncated: boolean;
}

export interface MeterImpactView {
    eligible: boolean;
    currentRole: string;
    currentKind: string;
    proposedRole: string;
    proposedKind: string;
    surfaces: MeterImpactSurface[];
    reportInterpretation: string;
    acknowledgement: string;
    ineligibilityReasons: string[];
}

type MeterIneligibilityReason =
    EnergyPreviewLogicalMeterMeaningChangeResponse['ineligibilityReasons'][number];

const UTILITY_LABELS: Record<EnergyUtilityType, string> = {
    electric: 'Electricity',
    gas: 'Gas',
    water: 'Water',
    heat: 'Heat'
};

const MEASUREMENT_LABELS: Record<string, string> = {
    total_act_energy: 'Imported active energy',
    total_act_ret_energy: 'Returned active energy',
    volume_m3: 'Consumed volume',
    volume_returned_m3: 'Returned / injected gas volume',
    volume_l: 'Consumed volume',
    thermal_energy_kwh: 'Thermal energy'
};

const INELIGIBILITY_LABELS: Record<MeterIneligibilityReason, string> = {
    meter_not_found: 'The logical meter no longer exists.',
    revision_changed:
        'Another operator changed this meter after the preview started.',
    meaning_unchanged: 'The proposed role and end use are unchanged.',
    effective_from_not_in_history:
        'The effective time falls outside available meter history.',
    effective_from_on_existing_boundary:
        'A classification revision already begins at this exact time.',
    effective_from_not_aligned:
        'The effective time must align to a 15-minute boundary.',
    kind_not_available: 'The selected end-use kind is no longer available.'
};

const TRUNCATED_ACKNOWLEDGEMENT =
    'I reviewed the physical counters, effective time, evidence, and the shown affected records. I understand that additional affected records are not listed.';
const FULL_ACKNOWLEDGEMENT =
    'I reviewed the physical counters, effective time, evidence, and every affected product surface.';

export function utilityLabel(utility: EnergyUtilityType): string {
    return UTILITY_LABELS[utility];
}

export function roleLabel(
    role: EnergyMeterRole,
    vocabulary: MeterVocabulary
): string {
    const options = vocabulary.utilityType
        ? energyRolesForUtility(vocabulary.utilityType)
        : [];
    return (
        options.find((option) => option.role === role)?.label ?? titleCase(role)
    );
}

export function kindLabel(
    kindId: string | null | undefined,
    vocabulary: MeterVocabulary
): string {
    if (!kindId) return 'No end use';
    const kind = vocabulary.kinds.find((entry) => entry.id === kindId);
    return kind?.name ?? titleCase(kindId);
}

/** End-use kinds as the picker offers them: categories A-Z, names A-Z. */
export function kindGroups(kinds: KindEntry[]): MeterKindGroup[] {
    const grouped = new Map<string, KindEntry[]>();
    for (const kind of [...kinds].sort((left, right) =>
        left.name.localeCompare(right.name)
    )) {
        const entries = grouped.get(kind.category) ?? [];
        entries.push(kind);
        grouped.set(kind.category, entries);
    }
    return [...grouped.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([label, items]) => ({label: titleCase(label), items}));
}

export function measurementLabel(tag: string): string {
    return MEASUREMENT_LABELS[tag] ?? titleCase(tag);
}

export function pointDirectionLabel(point: EnergyLogicalMeterPoint): string {
    if (point.directionHint) return titleCase(point.directionHint);
    if (
        point.tag === 'total_act_ret_energy' ||
        point.tag === 'volume_returned_m3'
    ) {
        return point.tag === 'volume_returned_m3'
            ? 'Network injection'
            : 'Export';
    }
    return 'Import / consumption';
}

export function meterPointRows(
    points: EnergyLogicalMeterPoint[],
    describeDevice: (deviceId: number) => MeterDeviceLabels
): MeterPointRow[] {
    return points.map((point) => ({
        key: pointKey(point),
        device: describeDevice(point.deviceId),
        counter: point.componentKey ?? 'Stored point',
        channel: point.channel ?? 0,
        measurement: measurementLabel(point.tag),
        direction: pointDirectionLabel(point)
    }));
}

export function meterListRows(
    meters: EnergyLogicalMeter[],
    context: MeterListContext
): MeterListRow[] {
    return meters.map((meter) => {
        const review = context.reviews.get(meter.id);
        return {
            id: meter.id,
            name: meter.name,
            utility: utilityLabel(meter.utilityType),
            role: roleLabel(meter.role, context.vocabulary),
            kind: kindLabel(meter.kindId, context.vocabulary),
            underReview: review != null,
            confidenceLabel: review
                ? confidenceLabel(review.suggestion.confidence)
                : null,
            searchText: meterSearchText(meter, context.describeDevice)
        };
    });
}

export function visibleMeterRows(
    rows: MeterListRow[],
    view: MeterListView
): MeterListRow[] {
    const query = view.search.trim().toLocaleLowerCase();
    return rows.filter(
        (row) =>
            (view.filter === 'all' || row.underReview) &&
            (query === '' || row.searchText.includes(query))
    );
}

/** Newest revision first is the server's order; the rows keep it. */
export function meterRevisionRows(
    versions: EnergyLogicalMeterMeaning[],
    vocabulary: MeterVocabulary
): MeterRevisionRow[] {
    return versions.map((version) => ({
        revision: version.revision,
        role: roleLabel(version.role, vocabulary),
        kind: kindLabel(version.kindId, vocabulary),
        interval: meaningInterval(version)
    }));
}

export function meterListEmptyState(view: MeterListView): MeterListEmptyState {
    if (view.search.trim()) {
        return {
            title: 'No meters match this search.',
            message: 'Clear the search or try a device identifier.'
        };
    }
    if (view.filter === 'review') {
        return {
            title: 'Every meter has a specific role and end use.',
            message:
                'New ambiguous meters will appear here with their supporting evidence.'
        };
    }
    return {
        title: 'No logical meters are configured.',
        message: 'Create the physical meter assignment from a device first.'
    };
}

export function confidencePercent(confidence: number): number {
    return Math.round(Math.max(0, Math.min(1, confidence)) * 100);
}

export function confidenceLabel(confidence: number): string {
    return `${confidencePercent(confidence)}% evidence`;
}

export function meaningInterval(meaning: EnergyLogicalMeterMeaning): string {
    const start = meaning.effectiveFrom
        ? formatDateTime(meaning.effectiveFrom)
        : 'Beginning of recorded history';
    return meaning.effectiveTo
        ? `${start} – ${formatDateTime(meaning.effectiveTo)}`
        : `${start} – present`;
}

/** The whole "review impact before applying" block, read from one preview. */
export function meterImpactView(
    preview: EnergyPreviewLogicalMeterMeaningChangeResponse,
    vocabulary: MeterVocabulary
): MeterImpactView {
    const surfaces = impactSurfaces(preview.affected);
    return {
        eligible: preview.eligible,
        currentRole: roleLabel(preview.current.role, vocabulary),
        currentKind: kindLabel(preview.current.kindId, vocabulary),
        proposedRole: roleLabel(preview.proposed.role, vocabulary),
        proposedKind: kindLabel(preview.proposed.kindId, vocabulary),
        surfaces,
        reportInterpretation: reportInterpretationLabel(
            preview.affected.reportInterpretation
        ),
        acknowledgement: acknowledgementLabel(surfaces),
        ineligibilityReasons: preview.ineligibilityReasons.map(
            (reason) => INELIGIBILITY_LABELS[reason]
        )
    };
}

/** The 15-minute UTC boundary a datetime-local field starts on. */
export function utcQuarterHour(value: Date): string {
    const date = new Date(value);
    date.setUTCSeconds(0, 0);
    date.setUTCMinutes(Math.floor(date.getUTCMinutes() / 15) * 15);
    return date.toISOString().slice(0, 16);
}

export function parseUtcDateTime(value: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
    const parsed = new Date(`${value}:00.000Z`);
    if (!Number.isFinite(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 16) === value ? parsed : null;
}

export function formatDateTime(value: string): string {
    const formatted = new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC'
    }).format(new Date(value));
    return `${formatted} UTC`;
}

function impactSurfaces(
    affected: EnergyLogicalMeterMeaningChangeImpact
): MeterImpactSurface[] {
    return [
        {key: 'dashboards', label: 'Dashboards', ...affected.dashboards},
        {key: 'alerts', label: 'Alerts', ...affected.alerts},
        {
            key: 'tariff-assignments',
            label: 'Tariff assignments',
            ...affected.tariffAssignments
        }
    ];
}

function reportInterpretationLabel(
    interval: EnergyLogicalMeterMeaningChangeImpact['reportInterpretation']
): string {
    return interval.to
        ? `${formatDateTime(interval.from)} – ${formatDateTime(interval.to)}`
        : `From ${formatDateTime(interval.from)}`;
}

// A truncated list cannot be read in full, so the operator acknowledges the
// records they were never shown.
function acknowledgementLabel(surfaces: MeterImpactSurface[]): string {
    return surfaces.some((surface) => surface.truncated)
        ? TRUNCATED_ACKNOWLEDGEMENT
        : FULL_ACKNOWLEDGEMENT;
}

function meterSearchText(
    meter: EnergyLogicalMeter,
    describeDevice: (deviceId: number) => MeterDeviceLabels
): string {
    const devices = meter.points
        .map((point) => describeDevice(point.deviceId))
        .map((device) => `${device.name} ${device.externalId}`)
        .join(' ');
    return `${meter.name} ${devices}`.toLocaleLowerCase();
}

function pointKey(point: EnergyLogicalMeterPoint): string {
    return [
        point.deviceId,
        point.componentKey ?? '',
        point.channel ?? 0,
        point.phase ?? 'z',
        point.tag,
        point.electricalDomain ?? ''
    ].join('|');
}

function titleCase(value: string): string {
    return value
        .replaceAll('_', ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

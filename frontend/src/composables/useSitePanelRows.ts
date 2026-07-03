import type {Location as ApiLocation} from '@api/location';
import {computed} from 'vue';
import type {
    LocationHealth,
    LocationStatus
} from '@/composables/useLocationStatus';
import {useLocationStatus} from '@/composables/useLocationStatus';
import {usePinAlertCounts} from '@/composables/usePinAlertCounts';
import {useLocationsStore} from '@/stores/locations';

export interface SitePanelRow {
    id: number;
    name: string;
    summary: string;
    countryCode: string;
    status: LocationStatus;
    online: number;
    total: number;
    alertCount: number;
}

const SITE_KINDS = new Set(['site', 'building']);

function isSiteLike(location: ApiLocation): boolean {
    return SITE_KINDS.has(location.kind);
}

function locationSummary(location: ApiLocation): string {
    const address = (
        location.kindFields as {address?: {city?: string; countryCode?: string}}
    )?.address;
    if (!address) return '';
    return [address.city, address.countryCode].filter(Boolean).join(', ');
}

function locationCountryCode(location: ApiLocation): string {
    const address = (location.kindFields as {address?: {countryCode?: string}})
        ?.address;
    return address?.countryCode?.trim().toUpperCase() ?? '';
}

function buildRow(
    location: ApiLocation,
    health: LocationHealth | undefined,
    alertCount: number
): SitePanelRow {
    return {
        id: location.id,
        name: location.name,
        summary: locationSummary(location),
        countryCode: locationCountryCode(location),
        status: health?.status ?? 'unknown',
        online: health?.online ?? 0,
        total: health?.total ?? 0,
        alertCount
    };
}

// Sort weight: alerts > offline > warn > unknown > on.
const STATUS_PRIORITY: Record<LocationStatus, number> = {
    off: 3,
    warn: 2,
    unknown: 1,
    on: 0
};

function compareRowSeverity(a: SitePanelRow, b: SitePanelRow): number {
    if (a.alertCount !== b.alertCount) return b.alertCount - a.alertCount;
    const sevDelta = STATUS_PRIORITY[b.status] - STATUS_PRIORITY[a.status];
    if (sevDelta !== 0) return sevDelta;
    return a.name.localeCompare(b.name);
}

function buildSitePanelRows(
    locations: ApiLocation[],
    health: Map<number, LocationHealth>,
    alertsByLocation: Map<number, number>
): SitePanelRow[] {
    const rows: SitePanelRow[] = [];
    for (const location of locations) {
        if (!isSiteLike(location)) continue;
        rows.push(
            buildRow(
                location,
                health.get(location.id),
                alertsByLocation.get(location.id) ?? 0
            )
        );
    }
    rows.sort(compareRowSeverity);
    return rows;
}

// Group rows by countryCode; "" bucket lands at the end as "Unspecified".
export interface SitePanelCountryGroup {
    countryCode: string;
    countryLabel: string;
    rows: SitePanelRow[];
    totalAlerts: number;
}

const UNSPEC_LABEL = 'Unspecified';

function groupRowsByCountry(
    rows: readonly SitePanelRow[]
): SitePanelCountryGroup[] {
    const byCode = new Map<string, SitePanelRow[]>();
    for (const row of rows) {
        const key = row.countryCode || '';
        const bucket = byCode.get(key);
        if (bucket) bucket.push(row);
        else byCode.set(key, [row]);
    }
    const groups: SitePanelCountryGroup[] = [];
    for (const [code, list] of byCode) {
        groups.push({
            countryCode: code,
            countryLabel: code || UNSPEC_LABEL,
            rows: list,
            totalAlerts: list.reduce((sum, r) => sum + r.alertCount, 0)
        });
    }
    // Country with most alerts first; "" / Unspecified always last.
    groups.sort((a, b) => {
        if (!a.countryCode && b.countryCode) return 1;
        if (a.countryCode && !b.countryCode) return -1;
        if (a.totalAlerts !== b.totalAlerts)
            return b.totalAlerts - a.totalAlerts;
        return a.countryLabel.localeCompare(b.countryLabel);
    });
    return groups;
}

export const __testing = {
    isSiteLike,
    locationSummary,
    compareRowSeverity,
    buildSitePanelRows,
    groupRowsByCountry
};

export function useSitePanelRows() {
    const locationsStore = useLocationsStore();
    const {health} = useLocationStatus();
    const {byLocation: alertsByLocation} = usePinAlertCounts();

    const rows = computed<SitePanelRow[]>(() =>
        buildSitePanelRows(
            Object.values(locationsStore.locations) as ApiLocation[],
            health.value,
            alertsByLocation.value
        )
    );

    const groups = computed<SitePanelCountryGroup[]>(() =>
        groupRowsByCountry(rows.value)
    );

    return {rows, groups};
}

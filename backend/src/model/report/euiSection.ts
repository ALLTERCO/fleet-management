// EUI / benchmark section (report engine v2): each in-scope site's energy
// normalized to kWh/m², kWh/person and kWh/throughput (Phase 14) so sites can
// be compared. A new section with no v1 equivalent, so no row-for-row parity
// constraint — it appears only when at least one in-scope site has area,
// headcount or throughput metadata.

import {computeEUI, type SiteMetadata} from './eui';

export interface EuiSiteInput {
    locationId: number;
    totalKwh: number;
    site: SiteMetadata;
}

export interface EuiInput {
    sites: ReadonlyArray<EuiSiteInput>;
    period: {from: Date; to: Date};
}

export interface EuiRow {
    locationId: number;
    annualizedPerM2: number | null;
    perPerson: number | null;
    perThroughput: number | null;
    throughputUnit: string | null;
}

function hasMetadata(site: SiteMetadata): boolean {
    return (
        typeof site.areaM2 === 'number' ||
        typeof site.headcount === 'number' ||
        typeof site.throughputValue === 'number'
    );
}

function rowFor(
    input: EuiSiteInput,
    period: EuiInput['period']
): EuiRow | null {
    if (!hasMetadata(input.site)) return null;
    const eui = computeEUI({
        totalKwh: input.totalKwh,
        site: input.site,
        period
    });
    return {
        locationId: input.locationId,
        annualizedPerM2: eui.annualizedPerM2,
        perPerson: eui.perPerson,
        perThroughput: eui.perThroughput,
        throughputUnit: eui.throughputUnit
    };
}

// Null when no in-scope site carries any benchmarkable metadata.
export function buildEuiSection(input: EuiInput): {rows: EuiRow[]} | null {
    const rows = input.sites
        .map((site) => rowFor(site, input.period))
        .filter((row): row is EuiRow => row !== null);
    return rows.length > 0 ? {rows} : null;
}

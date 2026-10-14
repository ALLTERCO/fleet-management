import type {SummaryCounts} from '../../types/api/_shared';

type CountValue = number | string | null | undefined;

export interface LocationSummaryCountRow {
    c_child_locations?: CountValue;
    c_devices?: CountValue;
    c_entities?: CountValue;
    c_tags?: CountValue;
    c_descendant_devices?: CountValue;
    c_descendant_entities?: CountValue;
    c_groups_referencing?: CountValue;
}

/**
 * Project only the summary counts the database actually returned.
 *
 * SummaryCounts fields are optional by contract. SQL NULL therefore means
 * unavailable, not zero. A real COUNT(*) result of 0 is preserved as 0.
 */
export function locationSummaryCountsFromRow(
    row: LocationSummaryCountRow
): SummaryCounts | undefined {
    const counts: SummaryCounts = {};

    if (row.c_child_locations != null) {
        counts.childLocations = Number(row.c_child_locations);
    }
    if (row.c_devices != null) counts.devices = Number(row.c_devices);
    if (row.c_entities != null) counts.entities = Number(row.c_entities);
    if (row.c_tags != null) counts.tags = Number(row.c_tags);
    if (row.c_descendant_devices != null) {
        counts.descendantDevices = Number(row.c_descendant_devices);
    }
    if (row.c_descendant_entities != null) {
        counts.descendantEntities = Number(row.c_descendant_entities);
    }
    if (row.c_groups_referencing != null) {
        counts.groupsReferencingLocation = Number(row.c_groups_referencing);
    }

    return Object.keys(counts).length > 0 ? counts : undefined;
}

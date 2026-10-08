/**
 * Single source of truth for "given a DashboardEntry, what detail view opens
 * when the user clicks it?". Mirrors useDashboardEntryRenderer's resolver
 * pattern: a pure function with injected lookups, so the dashboard page, the
 * per-card click affordance (DashboardEntryView) and tests all share one
 * answer and the click behavior can never drift from the render path.
 *
 * Returns null when the entry has no detail view — clock tiles, broken
 * widgets, and entries whose backing record isn't loaded. Callers use null
 * to suppress the click affordance.
 */

import type {ResolverContext} from '@/composables/useDashboardEntryRenderer';
import {UI_WIDGET_META} from '@/helpers/widgetSamples';
import type {entity_t} from '@/types';
import type {DashboardEntry, UiWidgetId} from '@/types/dashboard-entry';

/** Lookups the detail resolver needs beyond the render context. */
export interface DetailResolverContext extends ResolverContext {
    /** Device presence check — a device tile only opens the inspector when
     *  the device record is actually loaded. */
    device: (shellyID: string) => unknown | undefined;
}

export type DashboardDetail =
    | {kind: 'entity'; entity: entity_t}
    | {kind: 'widget'; widgetId: UiWidgetId; title: string}
    | {kind: 'device'; deviceId: string}
    | {kind: 'action'; actionId: string}
    | {kind: 'group'; groupId: number}
    | {kind: 'location'; locationId: number}
    | {kind: 'tag'; tagId: number};

// The clock is ambient (no data behind it) and the error tile has nothing
// more to show than the card already does.
const NO_DETAIL_WIDGETS = new Set<string>(['clock_widget', 'broken_widget']);

// Backend ids start at 1; mapItem writes 0 for a missing reference, so 0
// (or anything non-integer) means "no record behind this tile".
function isPersistedRef(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/** Resolve a dashboard entry to the detail view its click opens, or null. */
export function resolveDashboardDetail(
    entry: DashboardEntry,
    ctx: DetailResolverContext
): DashboardDetail | null {
    switch (entry.type) {
        case 'entity': {
            const entity =
                ctx.entityCache.get(entry.data?.id)?.entity ??
                ctx.rawEntity(entry.data?.id);
            return entity ? {kind: 'entity', entity} : null;
        }

        case 'device': {
            // Same id resolution as the render resolver: new entries store
            // the durable id at data.id, legacy ones the hardware id at
            // data.shellyID.
            const deviceRef = entry.data?.id ?? entry.data?.shellyID;
            const deviceId =
                typeof deviceRef === 'number'
                    ? ctx.deviceExternalId(deviceRef)
                    : deviceRef;
            if (!deviceId || !ctx.device(deviceId)) return null;
            return {kind: 'device', deviceId};
        }

        case 'group':
            return ctx.group(entry.data?.id)
                ? {kind: 'group', groupId: entry.data.id}
                : null;

        // Location/tag tiles navigate to their organize page's ?preview=
        // deep link. That page resolves the id itself and tolerates unknown
        // ones, so — unlike groups — no store lookup gates the affordance;
        // matching the render path, which also draws these tiles unchecked.
        case 'location':
            return isPersistedRef(entry.data?.id)
                ? {kind: 'location', locationId: entry.data.id}
                : null;

        case 'tag':
            return isPersistedRef(entry.data?.id)
                ? {kind: 'tag', tagId: entry.data.id}
                : null;

        case 'action':
            return ctx.action(entry.data?.id)
                ? {kind: 'action', actionId: entry.data.id}
                : null;

        case 'ui_widget': {
            const widgetId = entry.data?.id;
            if (
                typeof widgetId !== 'string' ||
                NO_DETAIL_WIDGETS.has(widgetId) ||
                !(widgetId in UI_WIDGET_META)
            ) {
                return null;
            }
            const label = entry.data?.label;
            return {
                kind: 'widget',
                widgetId: widgetId as UiWidgetId,
                title:
                    typeof label === 'string' && label
                        ? label
                        : UI_WIDGET_META[widgetId as UiWidgetId].name
            };
        }

        default:
            return null;
    }
}

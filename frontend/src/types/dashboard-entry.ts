/**
 * Single-source types for items rendered on a dashboard.
 * Shared by the live dashboard renderer and the add-widget catalog preview.
 */

// Card size is owned by the widget catalog (single source of truth for the
// size vocabulary + rules). Re-exported here so the renderer keeps one import.
import type {CardSize} from '@/helpers/widgetCatalog';

export type {CardSize};

export type DashboardEntryType =
    | 'entity'
    | 'device'
    | 'group'
    | 'location'
    | 'tag'
    | 'action'
    | 'ui_widget'
    | 'unknown';

/** Discriminated by `type`. `data` shape depends on `type` — kept loose here
 *  because the renderer interprets it per-branch. The backend stores it as
 *  arbitrary JSON in the dashboard items array. */
export interface DashboardEntry {
    id?: number;
    type: DashboardEntryType;
    size: CardSize;
    data: Record<string, any>;
}

/** Widget IDs recognised by the renderer for `type === 'ui_widget'`. */
export type UiWidgetId =
    | 'chart_widget'
    | 'gauge_widget'
    | 'stats_summary_widget'
    | 'top_consumers_widget'
    | 'state_timeline_widget'
    | 'activity_heatmap_widget'
    | 'energy_flow_sankey_widget'
    | 'fleet_kpi_strip_widget'
    | 'site_grid_widget'
    | 'maintenance_list_widget'
    | 'cross_site_bar_widget'
    | 'data_table_widget'
    | 'clock_widget'
    | 'broken_widget';

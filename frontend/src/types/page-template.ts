/**
 * Types shared by PageTemplate and its callers.
 */

export type StatStatus = 'on' | 'off' | 'warn';

export interface StatItem {
    /** Numeric or string value shown in bold. */
    value: string | number;
    /** Label shown after the value (e.g. "online"). */
    label: string;
    /** Optional colored dot before the value. */
    status?: StatStatus;
    /** When true, value is rendered in `--color-primary-text` (e.g. "selected"). */
    highlight?: boolean;
    /** Optional Font Awesome icon class shown before the value. */
    icon?: string;
}

/**
 * Route-tab shape for the template's animated tab strip.
 * Structurally identical to `PageItem` from components/core/PageDropdown.vue
 * but defined here to avoid cross-import.
 */
export interface RouteTab {
    label: string;
    path: string;
    icon?: string;
    badge?: number;
    /** External link — opens in a new tab instead of router navigation. */
    external?: boolean;
}

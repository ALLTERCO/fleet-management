// Provide/inject keys used inside the dashboards route tree.
// Symbol.for keeps identity stable across Vite HMR reloads of this module.

import type {InjectionKey} from 'vue';

export interface OpenDashboardPaletteOptions {
    mode?: 'list' | 'create';
}

export const OPEN_DASHBOARD_PALETTE_KEY: InjectionKey<
    (options?: OpenDashboardPaletteOptions) => void
> = Symbol.for('fm.dashboards.open-palette');

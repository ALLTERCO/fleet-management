export interface LocationKpiSnapshot {
    readonly total: number;
    readonly on: number;
    readonly off: number;
    readonly warn: number;
    readonly powerKW: number;
    /** null when no energy-history source is wired — render as "—" not 0. */
    readonly todayKWh: number | null;
    /** null when no alert source is wired — render as "—" not 0. */
    readonly alerts: number | null;
    /** Wall-clock ms of the most recent device update across the subtree. 0 = unknown. */
    readonly lastSeenTs: number;
    readonly savingsPotentialPct: number;
    readonly firmwareHealthPct: number;
    readonly signalHealthPct: number;
}

/** Live-stream fallback state — surfaced to the card badge so users always
 *  know whether KPIs are streaming or a stale snapshot. 'unwired' means the
 *  backend topic adapter is the no-op stub. */
export type LiveFallback = 'live' | 'snapshot' | 'forbidden' | 'unwired';

/** Single source of truth for declaring the live stream stale. */
export const FOCUS_CARD_LIVENESS_TIMEOUT_MS = 8000;

export interface FocusCardDims {
    readonly w: number;
    readonly h: number;
}

export interface FocusCardPosition {
    readonly left: number;
    readonly top: number;
}

export interface FocusCardReserves {
    readonly edgePad: number;
    readonly topBar: number;
    readonly sidePanel: number;
    readonly pinGap: number;
}

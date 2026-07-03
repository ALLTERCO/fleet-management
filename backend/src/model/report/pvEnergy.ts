// PV-aware house consumption per configured mode. Inputs are already summed
// over the chosen grid + generation meters (device or single channel).
//   parallel/backup: house = grid import + generation − export
//   balcony:         house = grid import + generation (behind-meter, no export)

export type PvMode = 'parallel' | 'backup' | 'balcony';

// A chosen meter: a whole device (channel null) or one channel of it.
export interface PvMeterRef {
    device: string; // shellyID
    channel: number | null;
}

export interface PvConfig {
    mode: PvMode;
    gridRefs: PvMeterRef[];
    generationRefs: PvMeterRef[];
}

export interface ChannelTotalRow {
    device: number; // internal id
    channel: number | null;
    tag: string;
    totalWh: number;
}

const PV_MODES: ReadonlySet<string> = new Set([
    'parallel',
    'backup',
    'balcony'
]);

// The one home for PV-mode validation. Returns the typed mode or null. Used by
// the legacy dashboard-JSON parse and the roles path (which defaults to
// parallel when no dashboard mode is set).
export function parsePvMode(value: unknown): PvMode | null {
    return typeof value === 'string' && PV_MODES.has(value)
        ? (value as PvMode)
        : null;
}

// Parse a raw dashboard_settings row into a PvConfig, or null when PV is off /
// the row is malformed. Tolerant: an invalid mode or non-array refs disable PV
// rather than crashing the report.
export function parsePvConfigRow(
    row:
        | {
              pv_mode?: unknown;
              pv_grid_refs?: unknown;
              pv_generation_refs?: unknown;
          }
        | null
        | undefined
): PvConfig | null {
    const mode = parsePvMode(row?.pv_mode);
    if (mode === null) return null;
    const gridRefs = Array.isArray(row?.pv_grid_refs)
        ? (row.pv_grid_refs as PvMeterRef[])
        : [];
    const generationRefs = Array.isArray(row?.pv_generation_refs)
        ? (row.pv_generation_refs as PvMeterRef[])
        : [];
    if (gridRefs.length === 0 && generationRefs.length === 0) return null;
    return {mode, gridRefs, generationRefs};
}

const IMPORT_TAG = 'total_act_energy';
const EXPORT_TAG = 'total_act_ret_energy';
export const PV_ENERGY_TAGS = [IMPORT_TAG, EXPORT_TAG] as const;

// Two refs overlap if they can meter the same energy: same device, and either
// is whole-device (channel null) or they share a channel.
function refsOverlap(a: PvMeterRef, b: PvMeterRef): boolean {
    return (
        a.device === b.device &&
        (a.channel == null || b.channel == null || a.channel === b.channel)
    );
}

// First generation ref overlapping any grid ref, else null. A meter assigned to
// both roles would be double-counted, so callers reject it.
export function pvRefsOverlap(
    gridRefs: readonly PvMeterRef[],
    generationRefs: readonly PvMeterRef[]
): PvMeterRef | null {
    for (const g of generationRefs) {
        if (gridRefs.some((grid) => refsOverlap(grid, g))) return g;
    }
    return null;
}

// First ref that overlaps an earlier ref in the same array, else null. A
// whole-device ref plus a channel ref of the same device (or an exact dup)
// double-count, so callers reject it.
export function pvRefsSelfOverlap(
    refs: readonly PvMeterRef[]
): PvMeterRef | null {
    for (let i = 0; i < refs.length; i++) {
        for (let j = 0; j < i; j++) {
            if (refsOverlap(refs[i], refs[j])) return refs[i];
        }
    }
    return null;
}

// Sum a tag over a ref: one channel, or all channels when channel is null.
function sumRef(
    ref: PvMeterRef,
    tag: string,
    rows: readonly ChannelTotalRow[],
    idOf: (shellyID: string) => number | undefined
): number {
    const id = idOf(ref.device);
    if (id == null) return 0;
    let wh = 0;
    for (const row of rows) {
        if (row.device !== id || row.tag !== tag) continue;
        if (ref.channel != null && row.channel !== ref.channel) continue;
        wh += row.totalWh;
    }
    return wh;
}

function sumRefs(
    refs: readonly PvMeterRef[],
    tag: string,
    rows: readonly ChannelTotalRow[],
    idOf: (shellyID: string) => number | undefined
): number {
    return refs.reduce((acc, ref) => acc + sumRef(ref, tag, rows, idOf), 0);
}

// Resolve the grid + generation meters to the kWh inputs computePvEnergy needs.
export function resolvePvMeters(input: {
    gridRefs: readonly PvMeterRef[];
    generationRefs: readonly PvMeterRef[];
    rows: readonly ChannelTotalRow[];
    idOf: (shellyID: string) => number | undefined;
}): {
    gridImportKWh: number;
    gridExportKWh: number;
    pvGenerationKWh: number;
} {
    const {gridRefs, generationRefs, rows, idOf} = input;
    return {
        gridImportKWh: sumRefs(gridRefs, IMPORT_TAG, rows, idOf) / 1000,
        gridExportKWh: sumRefs(gridRefs, EXPORT_TAG, rows, idOf) / 1000,
        pvGenerationKWh: sumRefs(generationRefs, IMPORT_TAG, rows, idOf) / 1000
    };
}

export interface PvEnergyInput {
    mode: PvMode;
    gridImportKWh: number; // total_act_energy of grid meters
    gridExportKWh: number; // total_act_ret_energy of grid meters
    pvGenerationKWh: number; // total_act_energy of generation meters
}

export interface PvEnergyResult {
    houseConsumptionKWh: number;
    selfConsumedKWh: number;
    exportedKWh: number;
    gridImportKWh: number;
    pvGenerationKWh: number;
    selfConsumptionRatePct: number; // selfConsumed / generation
    selfSufficiencyRatePct: number; // selfConsumed / house
}

function clampPositive(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function round3(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

export function computePvEnergy(input: PvEnergyInput): PvEnergyResult {
    // Round the inputs first so the displayed rows reconcile exactly
    // (house = grid + generation − exported on the shown figures).
    const grid = round3(clampPositive(input.gridImportKWh));
    const generation = round3(clampPositive(input.pvGenerationKWh));
    const exported =
        input.mode === 'balcony'
            ? 0
            : round3(clampPositive(input.gridExportKWh));
    const selfConsumed = Math.max(0, round3(generation - exported));
    const house = Math.max(0, round3(grid + generation - exported));
    return {
        houseConsumptionKWh: house,
        selfConsumedKWh: selfConsumed,
        exportedKWh: exported,
        gridImportKWh: grid,
        pvGenerationKWh: generation,
        selfConsumptionRatePct:
            generation > 0 ? round1((selfConsumed / generation) * 100) : 0,
        selfSufficiencyRatePct:
            house > 0 ? round1((selfConsumed / house) * 100) : 0
    };
}

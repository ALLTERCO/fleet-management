// Firmware-status resolution. The category map is the single source of
// truth for dot-color class + label across firmware UI surfaces — adding
// a new category is one entry, no new branches in the rendering code.

export type FirmwareCategory =
    | 'checking'
    | 'stable'
    | 'beta'
    | 'current'
    | 'error';

export interface FirmwareStatusEntry {
    dot: string;
    label: string;
}

export const FIRMWARE_STATUS_MAP: Record<
    FirmwareCategory,
    FirmwareStatusEntry
> = {
    checking: {dot: 'fw-dot--checking', label: 'Checking…'},
    stable: {dot: 'fw-dot--stable', label: 'Stable'},
    beta: {dot: 'fw-dot--beta', label: 'Beta'},
    current: {dot: '', label: 'Up to date'},
    error: {dot: 'fw-dot--error', label: 'Check failed'}
};

// Shape of firmwareStore.firmwareInfo[shellyID] — we only care about the
// presence of available updates + checkStatus, so the type is the local
// minimum needed for resolution.
export interface FirmwareInfoSummary {
    checkStatus?: 'checking' | 'checked' | 'error' | string;
    availableStable?: {version?: string} | null;
    availableBeta?: {version?: string} | null;
}

// Answer — the firmware category for a device, or null when we have no
// info to classify. Checking wins (most live signal); then any
// available update, with stable preferred over beta; then "up to date"
// for a clean checked state; finally error for failed checks.
export function resolveFirmwareCategory(
    info: FirmwareInfoSummary | undefined | null
): FirmwareCategory | null {
    if (!info) return null;
    if (info.checkStatus === 'checking') return 'checking';
    if (info.availableStable) return 'stable';
    if (info.availableBeta) return 'beta';
    if (info.checkStatus === 'checked') return 'current';
    if (info.checkStatus === 'error') return 'error';
    return null;
}

// Answer — dot-color class for the firmware indicator, or null when no
// dot should render. The empty 'current' entry collapses to null so
// callers can `v-if` cleanly.
export function firmwareDotFor(
    info: FirmwareInfoSummary | undefined | null
): string | null {
    const category = resolveFirmwareCategory(info);
    if (!category) return null;
    return FIRMWARE_STATUS_MAP[category].dot || null;
}

// Answer — display label for the firmware status row. Stable/beta append
// the actual version number so users see what update is available;
// other categories use the static label.
export function firmwareStatusLabel(
    info: FirmwareInfoSummary | undefined | null
): {label: string} | null {
    const category = resolveFirmwareCategory(info);
    if (!category) return null;
    const entry = FIRMWARE_STATUS_MAP[category];
    if (category === 'stable' && info?.availableStable?.version) {
        return {label: `Stable ${info.availableStable.version}`};
    }
    if (category === 'beta' && info?.availableBeta?.version) {
        return {label: `Beta ${info.availableBeta.version}`};
    }
    return {label: entry.label};
}

// Progress-strip bar style per update phase. Single source of truth for
// the color + width per phase; callers map an UpdatePhase to a CSS rule
// for the fill bar without re-implementing the strategy elsewhere.
export type UpdatePhaseStyleKey =
    | 'idle'
    | 'downloading'
    | 'rebooting'
    | 'verifying'
    | 'success'
    | 'failed';

interface PhaseStyle {
    color: string;
    width: string | null;
}

const UPDATE_PHASE_STYLES: Record<UpdatePhaseStyleKey, PhaseStyle> = {
    idle: {color: 'var(--color-surface-4)', width: '0%'},
    downloading: {color: 'var(--color-primary)', width: null},
    rebooting: {color: 'var(--color-warning)', width: '100%'},
    verifying: {color: 'var(--color-primary)', width: '100%'},
    success: {color: 'var(--color-success)', width: '100%'},
    failed: {color: 'var(--color-danger)', width: '100%'}
};

export function firmwareProgressStyle(opts: {
    phase: UpdatePhaseStyleKey | string;
    percent: number;
}): {backgroundColor: string; width: string} {
    const phase =
        UPDATE_PHASE_STYLES[opts.phase as UpdatePhaseStyleKey] ??
        UPDATE_PHASE_STYLES.idle;
    return {
        backgroundColor: phase.color,
        width: phase.width ?? `${opts.percent}%`
    };
}

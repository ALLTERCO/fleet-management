// Composer registry — each entity type self-registers, readers look up by type.

import {envStr} from '../../config/envReader';

interface BaseComposerEntry {
    componentType: string;
    title: string;
    // FM_DISABLE_BETA_COMPONENTS hides entries from getComposer + knownEntityTypes.
    beta?: boolean;
}
export interface ActuatorComposerEntry extends BaseComposerEntry {
    role: 'actuator';
    // Required so action routing has a target ('Switch', 'PresenceZone', ...).
    shellyNamespace: string;
}
export interface SensorComposerEntry extends BaseComposerEntry {
    role: 'sensor';
}
export type ComposerEntry = ActuatorComposerEntry | SensorComposerEntry;

const ENTRIES = new Map<string, ComposerEntry>();
let disabledBetaTypes: Set<string> | undefined;

export function registerComposer(entry: ComposerEntry): void {
    if (ENTRIES.has(entry.componentType)) {
        throw new Error(
            `composer already registered for type '${entry.componentType}'`
        );
    }
    ENTRIES.set(entry.componentType, entry);
}

export function getComposer(componentType: string): ComposerEntry | undefined {
    const entry = ENTRIES.get(componentType);
    if (!entry) return undefined;
    if (entry.beta && isBetaDisabled(componentType)) return undefined;
    return entry;
}

export function knownEntityTypes(): readonly string[] {
    const out: string[] = [];
    for (const [type, entry] of ENTRIES) {
        if (entry.beta && isBetaDisabled(type)) continue;
        out.push(type);
    }
    return out;
}

export function shellyNamespaceForEntityType(
    componentType: string
): string | undefined {
    const entry = getComposer(componentType);
    return entry?.role === 'actuator' ? entry.shellyNamespace : undefined;
}

export function __resetComposerRegistryForTests(): void {
    ENTRIES.clear();
    disabledBetaTypes = undefined;
}

function isBetaDisabled(componentType: string): boolean {
    if (disabledBetaTypes === undefined) {
        disabledBetaTypes = parseDisabledBetaTypes();
    }
    return disabledBetaTypes.has(componentType);
}

function parseDisabledBetaTypes(): Set<string> {
    const raw = envStr('FM_DISABLE_BETA_COMPONENTS', '');
    if (!raw) return new Set();
    return new Set(raw.split(',').map((s) => s.trim()));
}

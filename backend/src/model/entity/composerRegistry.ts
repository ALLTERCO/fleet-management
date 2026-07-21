// Composer registry — each entity type self-registers, readers look up by type.

import {envStr} from '../../config/envReader';

interface BaseComposerEntry {
    componentType: string;
    title: string;
    // FM_DISABLE_BETA_COMPONENTS hides entries from getComposer + knownEntityTypes.
    beta?: boolean;
}
// role = control-capability; shellyNamespace = action-routing target. Two
// independent things: an actuator commands an output; a sensor doesn't, but may
// still expose maintenance methods (bm/pm1 ResetCounters) that need a target.
export interface ActuatorComposerEntry extends BaseComposerEntry {
    role: 'actuator';
    shellyNamespace: string;
}
export interface SensorComposerEntry extends BaseComposerEntry {
    role: 'sensor';
    shellyNamespace?: string;
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
    // Routing target, independent of control/sensor role.
    return getComposer(componentType)?.shellyNamespace;
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

/**
 * Industry-standard equipment + signal vocabulary.
 *
 * Backed by the Project Haystack normalized definitions grid
 * (https://project-haystack.org/download, AFL-3.0). The vendored
 * defs.json + LICENSE in this directory are the source of truth.
 *
 * Public surface exposes the vocabulary in product-friendly names —
 * "equipment types", "standard terms" — no Haystack jargon. The Haystack
 * source name is preserved in the LICENSE attribution (legally required)
 * and in this directory name for refresh provenance.
 *
 * Exports:
 *   - equipmentTypes() — the 76 equipment-class nouns (ahu, chiller,
 *     boiler, battery, circuit, elec-panel, elec-meter, evse-port, …)
 *     used to drive the device equipment-type dropdown
 *   - equipmentType(name) — single equipment-type lookup
 *   - standardTerms() — the full reference vocabulary (719 defs incl.
 *     sensors, units, quantities, markers, references) for advanced
 *     callers that need beyond equipment classes
 *   - standardTermsUnder(parent) — subtree extraction for any term
 *
 * No async, no I/O after first call. ~318KB on disk — parsed once,
 * cached for the process lifetime.
 */

import {readFileSync} from 'node:fs';
import path from 'node:path';

// Upstream JSON wraps every leaf in {_kind: 'symbol'|'uri'|'ref'|..., val: ...}.
// Internal only — never crosses our public boundary.
interface UpstreamTaggedValue {
    _kind: string;
    val: string;
}

interface UpstreamRawRow {
    def: UpstreamTaggedValue;
    doc?: string;
    is?: UpstreamTaggedValue | UpstreamTaggedValue[];
    lib?: UpstreamTaggedValue;
    wikipedia?: UpstreamTaggedValue;
    children?: UpstreamTaggedValue | UpstreamTaggedValue[];
    [key: string]: unknown;
}

interface UpstreamRawGrid {
    _kind: 'grid';
    meta: {ver: string};
    cols: Array<{name: string}>;
    rows: UpstreamRawRow[];
}

/** One row from the reference vocabulary — equipment, sensor, unit, etc. */
export interface StandardTerm {
    /** Canonical symbol — e.g. 'ahu', 'elec-meter', 'circuit'. */
    name: string;
    /** Source library — 'phIoT' | 'phIct' | 'phScience' | 'ph'. */
    lib: string;
    /** Human-readable description. */
    doc: string;
    /** Direct supertypes — e.g. ahu `is` [airHandlingEquip, equip]. */
    parents: readonly string[];
    /** Optional Wikipedia URL when the upstream def carries one. */
    wikipedia: string | null;
}

const DEFS_PATH = path.resolve(__dirname, 'defs.json');

let cachedTerms: ReadonlyMap<string, StandardTerm> | null = null;
let cachedEquipment: ReadonlyArray<StandardTerm> | null = null;

function unwrap(v: UpstreamTaggedValue | string | undefined): string {
    if (!v) return '';
    if (typeof v === 'string') return v;
    return v.val ?? '';
}

function unwrapList(
    v: UpstreamTaggedValue | UpstreamTaggedValue[] | undefined
): string[] {
    if (!v) return [];
    if (Array.isArray(v)) return v.map(unwrap).filter(Boolean);
    return [unwrap(v)];
}

function libShortName(libSymbol: string): string {
    // Upstream lib refs look like 'lib:phIoT' — strip the namespace.
    return libSymbol.replace(/^lib:/, '');
}

function loadTermsOnce(): ReadonlyMap<string, StandardTerm> {
    if (cachedTerms) return cachedTerms;
    const raw = JSON.parse(readFileSync(DEFS_PATH, 'utf8')) as UpstreamRawGrid;
    const map = new Map<string, StandardTerm>();
    for (const row of raw.rows) {
        const name = unwrap(row.def);
        if (!name) continue;
        map.set(name, {
            name,
            lib: libShortName(unwrap(row.lib)),
            doc: row.doc ?? '',
            parents: unwrapList(row.is),
            wikipedia: row.wikipedia ? unwrap(row.wikipedia) : null
        });
    }
    cachedTerms = map;
    return map;
}

/** Full reference vocabulary — ~719 standard terms. */
export function standardTerms(): ReadonlyMap<string, StandardTerm> {
    return loadTermsOnce();
}

/** Single-term lookup. Returns undefined for unknown names. */
export function lookupStandardTerm(name: string): StandardTerm | undefined {
    return loadTermsOnce().get(name);
}

/**
 * All terms whose `is` chain transitively includes `parent`. Used to pull
 * subtrees like "everything that's an equip" or "everything that's a
 * sensor". Excludes the parent itself.
 */
export function standardTermsUnder(parent: string): StandardTerm[] {
    const all = loadTermsOnce();
    const out: StandardTerm[] = [];
    const cache = new Map<string, boolean>();
    const isDescendant = (name: string): boolean => {
        if (name === parent) return true;
        const cached = cache.get(name);
        if (cached !== undefined) return cached;
        const term = all.get(name);
        if (!term) {
            cache.set(name, false);
            return false;
        }
        // Mark as visited before recursing to break cycles.
        cache.set(name, false);
        for (const p of term.parents) {
            if (isDescendant(p)) {
                cache.set(name, true);
                return true;
            }
        }
        return false;
    };
    for (const term of all.values()) {
        if (term.name === parent) continue;
        if (isDescendant(term.name)) out.push(term);
    }
    return out;
}

/**
 * Equipment-class nouns — the dropdown answer to "what kind of equipment
 * is this?". 76 entries today: ahu, chiller, boiler, battery, circuit,
 * elec-panel, elec-meter, evse-port, elevator, vrf-outdoorUnit, …
 */
export function equipmentTypes(): ReadonlyArray<StandardTerm> {
    if (cachedEquipment) return cachedEquipment;
    const sorted = standardTermsUnder('equip').sort((a, b) =>
        a.name.localeCompare(b.name)
    );
    cachedEquipment = sorted;
    return sorted;
}

/** Single equipment-type lookup. Returns undefined for non-equipment names. */
export function equipmentType(name: string): StandardTerm | undefined {
    const term = lookupStandardTerm(name);
    if (!term) return undefined;
    // Verify it's actually an equipment class — otherwise lookups would
    // succeed for non-equipment terms and callers would be confused.
    const equip = equipmentTypes();
    return equip.some((e) => e.name === name) ? term : undefined;
}

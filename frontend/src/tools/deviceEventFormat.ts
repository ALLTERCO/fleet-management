// Smart-parse for device change rows. Best-effort, human-readable summaries —
// the console toggles this on/off, and the raw form is ALWAYS available because
// the parser can miss or mislabel a field. Pure functions, fully testable.

export interface DeviceChange {
    ts?: string;
    component: string;
    field: string;
    prev: unknown;
    next: unknown;
    kind: string;
    source: string;
}

// "switch:0" -> {type: "switch", index: "0"}; "wifi" -> {type: "wifi"}.
export function splitComponent(component: string): {
    type: string;
    index?: string;
} {
    const colon = component.indexOf(':');
    if (colon === -1) return {type: component};
    return {
        type: component.slice(0, colon),
        index: component.slice(colon + 1)
    };
}

function titleCase(word: string): string {
    return word.length === 0 ? word : word[0].toUpperCase() + word.slice(1);
}

// "switch:0" -> "Switch 0"; "wifi" -> "Wifi".
export function componentLabel(component: string): string {
    const {type, index} = splitComponent(component);
    const label = titleCase(type);
    return index === undefined ? label : `${label} ${index}`;
}

function renderValue(value: unknown): string {
    if (value === null || value === undefined) return '∅';
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean' || typeof value === 'number') {
        return String(value);
    }
    return JSON.stringify(value);
}

// Raw form — the unparsed truth, always shown when smart-parse is off.
export function rawChange(change: DeviceChange): string {
    const path = change.field
        ? `${change.component}.${change.field}`
        : change.component;
    return `${path}: ${renderValue(change.prev)} → ${renderValue(change.next)}`;
}

// Boolean on/off fields read better as a verb than "false → true".
const BOOLEAN_FIELDS = new Set(['output', 'ison', 'on']);

// Human summary. Falls back to the raw form for anything it doesn't specialise,
// so an unknown field is never hidden — just shown plainly.
export function summarizeChange(change: DeviceChange): string {
    const label = componentLabel(change.component);
    // A device event is a point in time, not a transition (prev is null).
    if (change.kind === 'event') {
        const payload =
            change.next == null ? '' : ` ${renderValue(change.next)}`;
        return `${label} → ${change.field}${payload}`;
    }
    if (BOOLEAN_FIELDS.has(change.field) && typeof change.next === 'boolean') {
        return `${label} turned ${change.next ? 'ON' : 'OFF'}`;
    }
    if (!change.field) return `${label} ${rawChange(change)}`;
    return `${label} ${change.field}: ${renderValue(change.prev)} → ${renderValue(change.next)}`;
}

// Stable color per component type so a glance separates switch/meter/wifi/etc.
// Tokens come from the design system; the palette is intentionally small and
// cycles for unknown types via a deterministic hash.
const COMPONENT_COLORS: Record<string, string> = {
    switch: 'var(--color-primary)',
    cover: '#a78bfa',
    light: '#fbbf24',
    input: '#34d399',
    temperature: '#fb923c',
    humidity: '#38bdf8',
    wifi: '#94a3b8',
    sys: '#94a3b8'
};
const FALLBACK_PALETTE = [
    '#4495d1',
    '#a78bfa',
    '#34d399',
    '#fb923c',
    '#f472b6'
];

export function changeColor(component: string): string {
    const {type} = splitComponent(component);
    const known = COMPONENT_COLORS[type];
    if (known) return known;
    let hash = 0;
    for (let i = 0; i < type.length; i++) {
        hash = (hash * 31 + type.charCodeAt(i)) >>> 0;
    }
    return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
}

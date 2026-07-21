import {useDevicesStore} from '@/stores/devices';

// Data tables shared by the widget catalog UI. Pulled out of AddWidgetModal
// so the modal stays an orchestrator and the rules have one home + tests.

export type WidgetCategoryId =
    | 'devices'
    | 'groups'
    | 'locations'
    | 'tags'
    | 'actions'
    | 'widgets';

export interface WidgetCategoryOption {
    id: WidgetCategoryId;
    label: string;
    icon: string;
}

export const WIDGET_CATEGORIES: ReadonlyArray<WidgetCategoryOption> = [
    {id: 'devices', label: 'Devices', icon: 'fas fa-microchip'},
    {id: 'groups', label: 'Groups', icon: 'fas fa-layer-group'},
    {id: 'locations', label: 'Locations', icon: 'fas fa-location-dot'},
    {id: 'tags', label: 'Tags', icon: 'fas fa-tag'},
    {id: 'actions', label: 'Actions', icon: 'fas fa-bolt'},
    {id: 'widgets', label: 'Widgets', icon: 'fas fa-shapes'}
];

// Single source of truth for dashboard card sizes: the vocabulary, the option
// labels, the per-entity rule, and the cycle order all live here.
// `types/dashboard-entry.ts` re-exports this type so the renderer keeps one name.
export type CardSize = '1x1' | '2x1' | '2x2';

export interface CardSizeOption {
    value: CardSize;
    label: string;
}

export const WIDGET_SIZES: ReadonlyArray<CardSizeOption> = [
    {value: '1x1', label: 'Small'},
    {value: '2x1', label: 'Wide'},
    {value: '2x2', label: 'Large'}
];

// Entity types whose preview card is naturally compact and should default to
// 1×1. Everything else opens at 2×1.
export const COMPACT_ENTITY_TYPES: ReadonlySet<string> = new Set([
    'switch',
    'input',
    'button',
    'temperature',
    'humidity',
    'illuminance',
    'voltmeter',
    'boolean',
    'text',
    'number',
    'enum',
    'bthomesensor',
    'bthomedevice'
]);

// Accent name → RGB triplet for the card glow. Names come from the design
// system palette; RGB form is what the inline gradients need.
export const ACCENT_RGB: Record<string, string> = {
    blue: '68,149,209',
    pink: '244,114,182',
    amber: '245,158,11',
    teal: '20,184,166',
    green: '34,197,94',
    purple: '168,85,247',
    orange: '249,115,22',
    red: '239,68,68'
};

export const DEFAULT_ACCENT_RGB = ACCENT_RGB.blue;

// Answer — pick the default widget size for an entity type.
export function defaultSizeForEntityType(type?: string): CardSize {
    if (!type) return '1x1';
    return COMPACT_ENTITY_TYPES.has(type) ? '1x1' : '2x1';
}

const ALL_SIZES: CardSize[] = ['1x1', '2x1', '2x2'];
const WIFI_BATTERY_SIZES: CardSize[] = ['1x1', '2x1'];
const ONE_SIZE: CardSize[] = ['1x1'];

const RELAY_SIZES: CardSize[] = ['1x1', '2x1'];

// A wired input is on/off, a value, or a press — nothing fills a 2x2 (BLU remote
// buttons are a different type/card entirely, so they're unaffected).
const INPUT_SIZES: CardSize[] = ['1x1', '2x1'];

interface SizedEntity {
    type?: string;
    source?: string;
    properties?: {
        id?: number | string;
        objName?: string;
        controls?: Array<{kind?: string}>;
    };
}

// A switch earns a 2x2 only if it meters power/energy (something to fill it). A
// dry-contact relay reports no `apower`, so it caps at 2x1. Unknown/unloaded
// status counts as metered so nothing is capped mid-load — only a confirmed
// non-metered relay loses the big size.
function switchIsMetered(entity: SizedEntity): boolean {
    if (!entity.source) return true;
    const status = useDevicesStore().devices[entity.source]?.status;
    if (!status) return true;
    const sw = status[`switch:${entity.properties?.id ?? 0}`] as
        | {apower?: number}
        | undefined;
    if (!sw) return true;
    return sw.apower !== undefined;
}

// A button input is a single event source — a 2x1 shows nothing a 1x1 doesn't
// (last press only; the recent-press list is client-side and usually empty). Read
// the mode from the device config (input:N.type). Unknown/unloaded stays uncapped
// so an analog/count input isn't wrongly shrunk mid-load.
function inputIsButton(entity: SizedEntity): boolean {
    if (!entity.source) return false;
    const settings = useDevicesStore().devices[entity.source]?.settings;
    const cfg = settings?.[`input:${entity.properties?.id ?? 0}`] as
        | {type?: string}
        | undefined;
    return cfg?.type === 'button';
}

// Button/dimmer controls on a bthomedevice = a BLU remote. Count them so a
// single-button remote can be capped below 2x2.
function bluRemoteButtonCount(entity: SizedEntity): number {
    const controls = entity.properties?.controls;
    if (!Array.isArray(controls)) return 0;
    return controls.filter(
        (c) => c.kind === 'button' || c.kind === 'dimmer'
    ).length;
}

// Single-value sensors — one number to show, so a bigger tile is just filler.
// (Battery is handled separately: a BLU battery is single-value, a WiFi
// devicepower battery also has volts + power source, so it isn't.)
const SINGLE_VALUE_TYPES = new Set(['illuminance', 'voltmeter']);
const SINGLE_VALUE_OBJNAMES = new Set(['rotation', 'illuminance', 'moisture']);

function isSingleValueSensor(entity: SizedEntity): boolean {
    if (SINGLE_VALUE_TYPES.has(entity.type ?? '')) return true;
    return (
        entity.type === 'bthomesensor' &&
        SINGLE_VALUE_OBJNAMES.has(entity.properties?.objName ?? '')
    );
}

// Answer — the widget sizes an entity may take. Single home for the per-entity
// size rule. A WiFi sleeper battery (devicepower) reports percent + volts +
// power source, so it earns 1x1 or 2x1. A BLU battery and other single-value
// sensors (rotation, illuminance) are one number → 1x1 only. Everything else
// gets all three.
export function allowedSizesForEntity(
    entity: SizedEntity | undefined
): CardSize[] {
    if (!entity) return [...ALL_SIZES];
    if (entity.type === 'devicepower') return [...WIFI_BATTERY_SIZES];
    if (
        entity.type === 'bthomesensor' &&
        entity.properties?.objName === 'battery'
    )
        return [...ONE_SIZE];
    if (isSingleValueSensor(entity)) return [...ONE_SIZE];
    // Dry-contact relay — a switch with no power metering can't fill a 2x2.
    if (entity.type === 'switch' && !switchIsMetered(entity))
        return [...RELAY_SIZES];
    // Wired input — no 2x2. A button is a single event source, so it caps to 1x1
    // (a 2x1 shows nothing more); switch/analog/count keep 1x1 + 2x1.
    if (entity.type === 'input')
        return inputIsButton(entity) ? [...ONE_SIZE] : [...INPUT_SIZES];
    // Single-button BLU remote has nothing to fill a 2x2.
    if (entity.type === 'bthomedevice' && bluRemoteButtonCount(entity) === 1)
        return [...RELAY_SIZES];
    return [...ALL_SIZES];
}

// Answer — the next size when the user cycles a tile. Walks only the sizes the
// entity allows, so a battery tile hops 1x1 <-> 2x1 (never 2x2). A size outside
// the allowed set (e.g. a battery persisted at 2x2) resolves to the first.
export function nextSizeForEntity(
    current: CardSize,
    entity: SizedEntity | undefined
): CardSize {
    const sizes = allowedSizesForEntity(entity);
    const i = sizes.indexOf(current);
    return sizes[(i + 1) % sizes.length];
}

// Answer — an allowed size for rendering. A size the entity no longer permits
// (a battery tile saved at 2x2 before the cap) clamps down to the largest
// allowed, so old layouts self-heal with no migration.
export function clampSizeForEntity(
    size: CardSize,
    entity: SizedEntity | undefined
): CardSize {
    const sizes = allowedSizesForEntity(entity);
    return sizes.includes(size) ? size : sizes[sizes.length - 1];
}

// Answer — RGB triplet for an accent name, falling back to the brand blue.
export function rgbForAccent(name: string | undefined): string {
    if (!name) return DEFAULT_ACCENT_RGB;
    return ACCENT_RGB[name] ?? DEFAULT_ACCENT_RGB;
}

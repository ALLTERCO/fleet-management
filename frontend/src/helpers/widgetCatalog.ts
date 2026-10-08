import {useDevicesStore} from '@/stores/devices';
import type {UiWidgetId} from '@/types/dashboard-entry';

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
const UP_TO_WIDE: CardSize[] = ['1x1', '2x1'];
const ONE_SIZE: CardSize[] = ['1x1'];

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
    return controls.filter((c) => c.kind === 'button' || c.kind === 'dimmer')
        .length;
}

// Cap a card size HERE and nowhere else. A type absent from this table gets all
// three sizes. Only cap a type whose card has no layout for the bigger size.
const SIZE_CAP: Readonly<Record<string, CardSize[]>> = {
    illuminance: ONE_SIZE,
    voltmeter: ONE_SIZE,
    devicepower: UP_TO_WIDE
};

// Same table for BTHome objects, keyed by objName instead of entity type.
const BTHOME_SIZE_CAP: Readonly<Record<string, CardSize[]>> = {
    rotation: ONE_SIZE,
    illuminance: ONE_SIZE,
    moisture: ONE_SIZE,
    battery: ONE_SIZE
};

// Answer — the widget sizes an entity may take. Single home for the per-entity
// size rule; the renderer clamps a persisted oversize down to this answer.
export function allowedSizesForEntity(
    entity: SizedEntity | undefined
): CardSize[] {
    if (!entity) return [...ALL_SIZES];
    if (entity.type === 'bthomesensor')
        return [
            ...(BTHOME_SIZE_CAP[entity.properties?.objName ?? ''] ?? ALL_SIZES)
        ];
    const capped = SIZE_CAP[entity.type ?? ''];
    if (capped) return [...capped];
    // The rest need live device state, so they cannot live in the table above.
    // Dry-contact relay — a switch with no power metering can't fill a 2x2.
    if (entity.type === 'switch' && !switchIsMetered(entity))
        return [...UP_TO_WIDE];
    // Wired input — no 2x2. A button is a single event source, so it caps to 1x1
    // (a 2x1 shows nothing more); switch/analog/count keep 1x1 + 2x1.
    if (entity.type === 'input')
        return inputIsButton(entity) ? [...ONE_SIZE] : [...UP_TO_WIDE];
    // Single-button BLU remote has nothing to fill a 2x2.
    if (entity.type === 'bthomedevice' && bluRemoteButtonCount(entity) === 1)
        return [...UP_TO_WIDE];
    return [...ALL_SIZES];
}

const WIDE_OR_LARGE: CardSize[] = ['2x1', '2x2'];
const LARGE_ONLY: CardSize[] = ['2x2'];

// Sizes a widget may take, first entry is the size it opens at. Keyed by the
// UiWidgetId union like every other per-widget map, so adding a widget id fails
// to compile until its size is set here — the id union is the one source.
const WIDGET_SIZE_RULES: Readonly<Record<UiWidgetId, CardSize[]>> = {
    clock_widget: ALL_SIZES,
    gauge_widget: ALL_SIZES,
    // A plotted line, a ranked list or a metric row needs width to be read.
    chart_widget: WIDE_OR_LARGE,
    stats_summary_widget: WIDE_OR_LARGE,
    top_consumers_widget: WIDE_OR_LARGE,
    maintenance_list_widget: WIDE_OR_LARGE,
    cross_site_bar_widget: WIDE_OR_LARGE,
    fleet_kpi_strip_widget: WIDE_OR_LARGE,
    state_timeline_widget: ['2x2', '2x1'],
    site_grid_widget: ['2x2', '2x1'],
    // A 7x24 grid, a flow diagram and a five-column table do not survive
    // anything smaller.
    activity_heatmap_widget: LARGE_ONLY,
    energy_flow_sankey_widget: LARGE_ONLY,
    data_table_widget: LARGE_ONLY,
    // The error tile takes whatever size it was saved at.
    broken_widget: ALL_SIZES
};

function isWidgetId(kind: string | undefined): kind is UiWidgetId {
    return kind != null && kind in WIDGET_SIZE_RULES;
}

// Answer — the sizes a widget kind may take. A persisted kind we no longer know
// falls back to all three rather than throwing.
export function allowedSizesForWidget(kind: string | undefined): CardSize[] {
    return [...(isWidgetId(kind) ? WIDGET_SIZE_RULES[kind] : ALL_SIZES)];
}

// Answer — the size a widget opens at: the first size it allows.
export function defaultSizeForWidget(kind: string | undefined): CardSize {
    return allowedSizesForWidget(kind)[0];
}

// Answer — an allowed size for rendering a widget, clamping a persisted
// oversize down. Mirrors clampSizeForEntity for the widget axis.
export function clampSizeForWidget(
    size: CardSize,
    kind: string | undefined
): CardSize {
    const sizes = allowedSizesForWidget(kind);
    return sizes.includes(size) ? size : sizes[0];
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

// Answer — the size a newly added widget opens at, never above what the entity
// allows. Keeps the type default from offering a size the card can't take.
export function defaultSizeForEntity(
    entity: SizedEntity | undefined
): CardSize {
    return clampSizeForEntity(defaultSizeForEntityType(entity?.type), entity);
}

// Answer — RGB triplet for an accent name, falling back to the brand blue.
export function rgbForAccent(name: string | undefined): string {
    if (!name) return DEFAULT_ACCENT_RGB;
    return ACCENT_RGB[name] ?? DEFAULT_ACCENT_RGB;
}

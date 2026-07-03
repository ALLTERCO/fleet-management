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

export type WidgetSize = '1x1' | '2x1' | '2x2';

export interface WidgetSizeOption {
    value: WidgetSize;
    label: string;
}

export const WIDGET_SIZES: ReadonlyArray<WidgetSizeOption> = [
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
export function defaultSizeForEntityType(type?: string): WidgetSize {
    if (!type) return '1x1';
    return COMPACT_ENTITY_TYPES.has(type) ? '1x1' : '2x1';
}

// Answer — RGB triplet for an accent name, falling back to the brand blue.
export function rgbForAccent(name: string | undefined): string {
    if (!name) return DEFAULT_ACCENT_RGB;
    return ACCENT_RGB[name] ?? DEFAULT_ACCENT_RGB;
}

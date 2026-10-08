// Build-your-own quick-picks, derived from the backend starter templates
// (Rule.ListTemplates) so the config has a single source. The frontend adds
// only a presentation icon — never the component/field values.

import type {AlertRuleKind, AlertRuleTemplate} from '@api/alert';

export interface RulePresetChoice {
    readonly key: string;
    readonly label: string;
    readonly icon: string;
    readonly config: Record<string, unknown>;
}

// Only the two free-form condition kinds offer quick-picks; the rest configure
// themselves or have no per-field condition.
const KINDS_WITH_PRESETS: readonly AlertRuleKind[] = [
    'component_state',
    'component_threshold'
];

// Presentation only — an icon per component family. Not a contract fact.
const COMPONENT_ICON: Readonly<Record<string, string>> = {
    switch: 'fa-solid fa-toggle-on',
    cover: 'fa-solid fa-up-down',
    contact: 'fa-solid fa-door-open',
    input: 'fa-solid fa-door-open',
    temperature: 'fa-solid fa-temperature-half',
    humidity: 'fa-solid fa-droplet',
    pressure: 'fa-solid fa-gauge-high',
    co2: 'fa-solid fa-wind',
    tvoc: 'fa-solid fa-wind',
    carbon_monoxide: 'fa-solid fa-triangle-exclamation',
    gas: 'fa-solid fa-triangle-exclamation',
    presence: 'fa-solid fa-person-rays',
    occupancy: 'fa-solid fa-person-rays',
    motion: 'fa-solid fa-person-walking',
    tamper: 'fa-solid fa-shield-halved',
    vibration: 'fa-solid fa-wave-square',
    garage_door: 'fa-solid fa-warehouse',
    lock: 'fa-solid fa-lock',
    sound: 'fa-solid fa-volume-high',
    voltmeter: 'fa-solid fa-gauge',
    em: 'fa-solid fa-bolt',
    em1: 'fa-solid fa-bolt',
    pm1: 'fa-solid fa-bolt',
    devicepower: 'fa-solid fa-battery-half'
};

export function kindHasPresets(kind: AlertRuleKind): boolean {
    return KINDS_WITH_PRESETS.includes(kind);
}

function iconForConfig(config: Record<string, unknown>): string {
    const component = String(config.component ?? '');
    const family = component.split(':')[0];
    return COMPONENT_ICON[family] ?? 'fa-solid fa-sliders';
}

/** Answer: the quick-pick choices for a kind, built from its starter templates. */
export function presetsForKind(
    templates: readonly AlertRuleTemplate[],
    kind: AlertRuleKind
): RulePresetChoice[] {
    if (!kindHasPresets(kind)) return [];
    return templates
        .filter((template) => template.kind === kind)
        .map((template) => ({
            key: template.templateKey,
            label: template.label,
            icon: iconForConfig(template.config),
            config: template.config
        }));
}

/** The component family a preset watches, e.g. "bthomesensor" or "switch". */
export function presetComponentFamily(preset: RulePresetChoice): string {
    return String(preset.config.component ?? '').split(':')[0] ?? '';
}

/**
 * Narrow the quick-picks to signals the chosen devices can actually produce.
 *
 * Every preset of the matching kind used to show at once — fourteen of them for
 * component_state — so a fleet of covers was offered "Carbon monoxide detected"
 * and a chosen preset sat unmarked among thirteen alternatives. The available
 * set comes from the same catalog that fills the signal list below the chips,
 * so the two agree by construction.
 *
 * An empty available set means nothing is known yet — before any device is
 * chosen, or while the catalog loads — and everything is offered rather than
 * nothing.
 */
export function presetsForDevices(
    presets: readonly RulePresetChoice[],
    availableComponents: ReadonlySet<string>
): RulePresetChoice[] {
    if (availableComponents.size === 0) return [...presets];
    return presets.filter((preset) => {
        const family = presetComponentFamily(preset);
        // A wildcard preset (bthomesensor:*) matches on family alone.
        return family === '' || availableComponents.has(family);
    });
}

export interface RulePresetGroup {
    readonly label: string;
    readonly presets: readonly RulePresetChoice[];
}

// Presentation only, exactly like COMPONENT_ICON above — which family a signal
// belongs to is a scanning aid, never a contract fact. Order is fixed so the
// row does not reshuffle as the device filter changes what is on offer.
const PRESET_GROUPS: ReadonlyArray<{
    readonly label: string;
    readonly families: readonly string[];
}> = [
    {
        label: 'Switches & power',
        families: ['switch', 'em', 'em1', 'pm1', 'voltmeter', 'devicepower']
    },
    {
        label: 'Doors & access',
        families: ['cover', 'contact', 'input', 'garage_door', 'lock']
    },
    {
        label: 'Presence & security',
        families: [
            'presence',
            'occupancy',
            'motion',
            'tamper',
            'vibration',
            'sound'
        ]
    },
    {label: 'Climate', families: ['temperature', 'humidity', 'pressure']},
    {
        label: 'Air quality & safety',
        families: ['co2', 'tvoc', 'carbon_monoxide', 'gas']
    },
    // Promoted BLU sensors carry one family for several unrelated signals
    // (door/window, carbon monoxide, gas), so the family alone cannot place
    // them and they keep their own heading.
    {label: 'BLU sensors', families: ['bthomesensor']}
];

// A family nobody has classified still has to reach the user — a quick-pick
// that works is worse than useless if it is hidden.
const FALLBACK_GROUP_LABEL = 'Other';

function groupLabelFor(preset: RulePresetChoice): string {
    const family = presetComponentFamily(preset);
    const group = PRESET_GROUPS.find((candidate) =>
        candidate.families.includes(family)
    );
    return group?.label ?? FALLBACK_GROUP_LABEL;
}

/** Answer: the quick-picks arranged under the headings a person scans by. */
export function groupPresets(
    presets: readonly RulePresetChoice[]
): RulePresetGroup[] {
    const byLabel = new Map<string, RulePresetChoice[]>();
    for (const preset of presets) {
        const label = groupLabelFor(preset);
        const bucket = byLabel.get(label);
        if (bucket) bucket.push(preset);
        else byLabel.set(label, [preset]);
    }
    const ordered = [
        ...PRESET_GROUPS.map((g) => g.label),
        FALLBACK_GROUP_LABEL
    ];
    return ordered
        .filter((label) => byLabel.has(label))
        .map((label) => ({
            label,
            presets: byLabel.get(label) as RulePresetChoice[]
        }));
}

/** Answer: is this the quick-pick the condition currently holds? */
export function isPresetActive(
    preset: RulePresetChoice,
    config: Record<string, unknown>
): boolean {
    const keys = Object.keys(preset.config);
    if (keys.length === 0) return false;
    return keys.every(
        (key) =>
            JSON.stringify(config[key]) === JSON.stringify(preset.config[key])
    );
}

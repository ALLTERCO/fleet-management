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

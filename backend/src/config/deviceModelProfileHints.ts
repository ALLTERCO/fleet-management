// Maps a device model / app identifier to suggested profile keys.
// Used by Profile.SuggestFromDevice to boost confidence when the device
// model unambiguously implies a category. Community-extensible: new entries
// are 1-line additions, no schema change.
//
// Match strategy: case-insensitive substring against jdoc.info.app /
// jdoc.info.model / BLU productName. Each entry can suggest multiple
// profile keys (e.g. a Pro 4PM hints at both outlet-rack and per-outlet).

export interface DeviceModelProfileHint {
    pattern: string;
    profileKeys: readonly string[];
}

export const DEVICE_MODEL_PROFILE_HINTS: readonly DeviceModelProfileHint[] = [
    {pattern: 'shellyempro', profileKeys: ['energy_monitor', 'power_meter']},
    {pattern: 'shellyem', profileKeys: ['energy_monitor', 'power_meter']},
    {pattern: 'shellypro3em', profileKeys: ['energy_monitor', 'power_meter']},
    {pattern: 'shellytrv', profileKeys: ['thermostat', 'radiator_valve']},
    {
        pattern: 'shellyplusht',
        profileKeys: ['environment_sensor', 'room_climate']
    },
    {pattern: 'shellyht', profileKeys: ['environment_sensor', 'room_climate']},
    {pattern: 'shellygas', profileKeys: ['gas_sensor', 'safety_sensor']},
    {pattern: 'shellysmoke', profileKeys: ['smoke_sensor', 'safety_sensor']},
    {pattern: 'shellydw', profileKeys: ['door_window_sensor']},
    {pattern: 'shellyflood', profileKeys: ['flood_sensor', 'safety_sensor']},
    {pattern: 'shellymotion', profileKeys: ['motion_sensor']},
    {pattern: 'shellybutton', profileKeys: ['scene_controller']},
    {pattern: 'shellydimmer', profileKeys: ['light_dimmer']},
    {pattern: 'shellyrgbw', profileKeys: ['light_rgbw']},
    {pattern: 'shellybulb', profileKeys: ['light_bulb']},
    {pattern: 'shellyduo', profileKeys: ['light_cct']},
    {pattern: 'shellyvintage', profileKeys: ['light_bulb']},
    {pattern: 'shellypro4pm', profileKeys: ['outlet_rack_4', 'outlet_metered']},
    {pattern: 'shellypro2pm', profileKeys: ['outlet_rack_2', 'outlet_metered']},
    {pattern: 'shellyplus1pm', profileKeys: ['outlet_metered', 'switch']},
    {pattern: 'shellyplus2pm', profileKeys: ['outlet_metered', 'cover']},
    {pattern: 'shellypro1pm', profileKeys: ['outlet_metered', 'switch']},
    {pattern: 'shellypro2', profileKeys: ['cover', 'switch']},
    {pattern: 'walldisplay', profileKeys: ['wall_panel', 'thermostat']},
    {pattern: 'walldisplayv2', profileKeys: ['wall_panel', 'thermostat']},
    {pattern: 'shellyxt1', profileKeys: ['plc', 'controller']},
    {pattern: 'shellypill', profileKeys: ['battery_monitor']},
    {pattern: 'shellyblu', profileKeys: ['environment_sensor']}
];

export function suggestProfileKeysForModel(
    modelHint: string | null
): readonly string[] {
    if (!modelHint) return [];
    const haystack = modelHint.toLowerCase().replace(/[^a-z0-9]/g, '');
    const out = new Set<string>();
    for (const hint of DEVICE_MODEL_PROFILE_HINTS) {
        if (haystack.includes(hint.pattern)) {
            for (const key of hint.profileKeys) out.add(key);
        }
    }
    return Array.from(out);
}

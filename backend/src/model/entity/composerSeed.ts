// Built-in composer entries — call seedComposerRegistry() once at startup.

import type {ComposerEntry} from './composerRegistry';
import {registerComposer} from './composerRegistry';

const SEED: readonly ComposerEntry[] = [
    {
        role: 'actuator',
        componentType: 'switch',
        title: 'Switch',
        shellyNamespace: 'Switch'
    },
    {
        role: 'actuator',
        componentType: 'light',
        title: 'Light',
        shellyNamespace: 'Light'
    },
    {
        role: 'actuator',
        componentType: 'rgb',
        title: 'RGB Light',
        shellyNamespace: 'RGB'
    },
    {
        role: 'actuator',
        componentType: 'rgbw',
        title: 'RGBW Light',
        shellyNamespace: 'RGBW'
    },
    {
        role: 'actuator',
        componentType: 'cct',
        title: 'CCT Light',
        shellyNamespace: 'CCT'
    },
    {
        role: 'actuator',
        componentType: 'rgbcct',
        title: 'RGBCCT Light',
        shellyNamespace: 'RGBCCT'
    },
    {
        role: 'actuator',
        componentType: 'ledstrip',
        title: 'LED Strip',
        shellyNamespace: 'LedStrip'
    },
    {
        role: 'actuator',
        componentType: 'cover',
        title: 'Cover',
        shellyNamespace: 'Cover'
    },
    {
        role: 'actuator',
        componentType: 'input',
        title: 'Input',
        shellyNamespace: 'Input'
    },
    {
        role: 'actuator',
        componentType: 'thermostat',
        title: 'Thermostat',
        shellyNamespace: 'Thermostat'
    },

    {role: 'sensor', componentType: 'blutrv', title: 'BLU TRV'},
    {role: 'sensor', componentType: 'temperature', title: 'Temperature'},
    {role: 'sensor', componentType: 'humidity', title: 'Humidity'},
    {role: 'sensor', componentType: 'illuminance', title: 'Illuminance'},
    {role: 'sensor', componentType: 'voltmeter', title: 'Voltmeter'},
    {role: 'sensor', componentType: 'pm1', title: 'Power Meter'},
    {role: 'sensor', componentType: 'em', title: 'Energy Meter'},
    {
        role: 'sensor',
        componentType: 'em1',
        title: 'Energy Meter (single phase)'
    },
    {role: 'sensor', componentType: 'cury', title: 'Scent Diffuser'},
    {role: 'sensor', componentType: 'devicepower', title: 'Device Power'},
    {role: 'sensor', componentType: 'flood', title: 'Flood Sensor'},
    {role: 'sensor', componentType: 'smoke', title: 'Smoke Sensor'},
    {role: 'sensor', componentType: 'matter', title: 'Matter'},

    {role: 'sensor', componentType: 'bthomesensor', title: 'BTHome Sensor'},
    {role: 'sensor', componentType: 'bthomedevice', title: 'BTHome Device'},
    {role: 'sensor', componentType: 'bthomecontrol', title: 'BTHome Control'},

    {role: 'sensor', componentType: 'camera', title: 'Camera'},
    {role: 'sensor', componentType: 'camerazone', title: 'Camera Zone'},
    {role: 'sensor', componentType: 'presence', title: 'Presence'},
    {role: 'sensor', componentType: 'presencezone', title: 'Presence Zone'},

    {role: 'sensor', componentType: 'schedule', title: 'Schedule'},
    {role: 'sensor', componentType: 'media', title: 'Media'},
    {role: 'sensor', componentType: 'ui', title: 'Display'},
    {role: 'sensor', componentType: 'service', title: 'Service'},

    {role: 'sensor', componentType: 'boolean', title: 'Boolean'},
    {role: 'sensor', componentType: 'number', title: 'Number'},
    {role: 'sensor', componentType: 'text', title: 'Text'},
    {role: 'sensor', componentType: 'enum', title: 'Enum'},
    {role: 'sensor', componentType: 'button', title: 'Button'},
    {role: 'sensor', componentType: 'group', title: 'Group'},

    // `:N` instance form only — bare device singletons stay in NON_COMPONENT_KEYS.
    {
        // Meter, not a control device — namespace only routes BM.ResetCounters.
        role: 'sensor',
        componentType: 'bm',
        title: 'Battery Monitor',
        shellyNamespace: 'BM'
    },
    {
        role: 'actuator',
        componentType: 'cb',
        title: 'Circuit Breaker',
        shellyNamespace: 'CB'
    },
    {
        role: 'actuator',
        componentType: 'fan',
        title: 'Fan',
        shellyNamespace: 'Fan'
    },
    {
        role: 'actuator',
        componentType: 'lnm',
        title: 'Local Network Messaging',
        shellyNamespace: 'LNM'
    },
    {
        role: 'actuator',
        componentType: 'zigbee',
        title: 'Zigbee Bridge',
        shellyNamespace: 'Zigbee'
    },
    {
        role: 'actuator',
        componentType: 'pill',
        title: 'The Pill',
        shellyNamespace: 'Pill'
    },
    {
        role: 'actuator',
        componentType: 'dali',
        title: 'DALI Fixture',
        shellyNamespace: 'DALI'
    },
    {
        role: 'actuator',
        componentType: 'modbus',
        title: 'Modbus',
        shellyNamespace: 'Modbus'
    },
    {role: 'sensor', componentType: 'object', title: 'Virtual Object'},
    {
        role: 'actuator',
        componentType: 'script',
        title: 'Script',
        shellyNamespace: 'Script'
    },
    // emdata/em1data are flash-archive; live em values flow via em/em1.
    {role: 'sensor', componentType: 'emdata', title: 'Energy Archive'},
    {
        role: 'sensor',
        componentType: 'em1data',
        title: 'Energy Archive (single phase)'
    }
];

export function seedComposerRegistry(): void {
    for (const entry of SEED) registerComposer(entry);
}

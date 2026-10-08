import type {DeviceProfile} from '../types';
import {
    makeProfile,
    mergeComponents,
    type ProfileComponents,
    type ProfileIdentity,
    pmComponents
} from './shared';

// Virtual (dynamic) components are user-defined controls layered onto a device
// through the Shelly virtual-component API. Real integrations — a battery
// inverter, an HVAC bridge — surface their controls this way, so these two
// profiles model those use cases while exercising every `meta.ui.view` the
// frontend renders: toggle, label, slider, progressbar, number field, text
// field, dropdown, button, object and group.
const DOC_ROOT =
    'https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Virtual/';

// A 1x1 SVG data URI stands in for a unit photo so the text `image` view has
// something self-contained to render.
const UNIT_PHOTO =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='72'%3E%3Crect width='120' height='72' rx='8' fill='%230D1B2E'/%3E%3Ctext x='60' y='42' font-family='sans-serif' font-size='16' fill='%234495D1' text-anchor='middle'%3EHVAC%3C/text%3E%3C/svg%3E";

function virtualProfile(
    identity: Omit<ProfileIdentity, 'gen' | 'sourceUrl'>,
    doc: string,
    components: ProfileComponents
): DeviceProfile {
    return makeProfile({
        identity: {...identity, gen: 3, sourceUrl: `${DOC_ROOT}${doc}/`},
        components
    });
}

// Solar hybrid inverter: battery readings, grid/power controls and dispatch
// actions. Covers number progressbar/field/label/slider, enum dropdown,
// boolean toggle/label, object and buttons.
const inverterComponents: ProfileComponents = {
    config: {
        'number:200': {
            id: 200,
            name: 'Battery SOC',
            min: 0,
            max: 100,
            meta: {ui: {view: 'progressbar', unit: '%'}}
        },
        'number:203': {
            id: 203,
            name: 'Battery power',
            meta: {ui: {view: 'label', unit: 'W'}}
        },
        'number:201': {
            id: 201,
            name: 'Grid export limit',
            min: 0,
            max: 5000,
            meta: {ui: {view: 'field', unit: 'W', step: 50}}
        },
        'number:202': {
            id: 202,
            name: 'Control power',
            min: 0,
            max: 2500,
            meta: {ui: {view: 'slider', unit: 'W', step: 50}}
        },
        'enum:200': {
            id: 200,
            name: 'Work mode',
            options: ['self_use', 'charge', 'discharge', 'passive'],
            meta: {
                ui: {
                    view: 'dropdown',
                    titles: {
                        self_use: 'Self-use',
                        charge: 'Force charge',
                        discharge: 'Force discharge',
                        passive: 'Passive'
                    }
                }
            }
        },
        'boolean:200': {
            id: 200,
            name: 'Away mode',
            meta: {ui: {view: 'toggle', titles: {0: 'Home', 1: 'Away'}}}
        },
        'boolean:201': {
            id: 201,
            name: 'Grid connection',
            meta: {ui: {view: 'label', titles: {0: 'Islanded', 1: 'On-grid'}}}
        },
        'object:200': {
            id: 200,
            name: 'Phase info',
            meta: {ui: {view: 'label'}}
        },
        'button:200': {
            id: 200,
            name: 'Force charge',
            meta: {ui: {view: 'button'}}
        },
        'button:201': {
            id: 201,
            name: 'Force discharge',
            meta: {ui: {view: 'button'}}
        },
        'button:202': {id: 202, name: 'Stop', meta: {ui: {view: 'button'}}}
    },
    status: {
        'number:200': {value: 64},
        'number:203': {value: 320},
        'number:201': {value: 3000},
        'number:202': {value: 800},
        'enum:200': {value: 'self_use'},
        'boolean:200': {value: false},
        'boolean:201': {value: true},
        'object:200': {
            value: {
                a: {voltage: 230.4, current: 4.12},
                b: {voltage: 229.8, current: 3.86},
                c: {voltage: 231.0, current: 5.01},
                total_power: 1664.2,
                calibrated: true
            }
        }
    }
};

// HVAC / heat-pump controller: room readings, setpoint and mode controls, a
// zone label, a service note, a unit photo and a filter-reset action. Adds the
// text field/label/image views and a group that bundles its main controls.
const hvacComponents: ProfileComponents = {
    config: {
        'number:200': {
            id: 200,
            name: 'Room temperature',
            meta: {ui: {view: 'label', unit: '°C'}}
        },
        'number:201': {
            id: 201,
            name: 'Humidity',
            min: 0,
            max: 100,
            meta: {ui: {view: 'progressbar', unit: '%'}}
        },
        'number:202': {
            id: 202,
            name: 'Setpoint',
            min: 16,
            max: 30,
            meta: {ui: {view: 'slider', unit: '°C', step: 0.5}}
        },
        'enum:200': {
            id: 200,
            name: 'Mode',
            options: ['cool', 'heat', 'auto', 'dry', 'fan'],
            meta: {
                ui: {
                    view: 'dropdown',
                    titles: {
                        cool: 'Cool',
                        heat: 'Heat',
                        auto: 'Auto',
                        dry: 'Dry',
                        fan: 'Fan only'
                    }
                }
            }
        },
        'enum:201': {
            id: 201,
            name: 'Fan speed',
            options: ['auto', 'low', 'medium', 'high'],
            meta: {
                ui: {
                    view: 'dropdown',
                    titles: {
                        auto: 'Auto',
                        low: 'Low',
                        medium: 'Medium',
                        high: 'High'
                    }
                }
            }
        },
        'boolean:200': {
            id: 200,
            name: 'Eco mode',
            meta: {ui: {view: 'toggle', titles: {0: 'Off', 1: 'On'}}}
        },
        'boolean:201': {
            id: 201,
            name: 'Compressor',
            meta: {ui: {view: 'label', titles: {0: 'Idle', 1: 'Running'}}}
        },
        'text:200': {
            id: 200,
            name: 'Zone name',
            max_len: 32,
            meta: {ui: {view: 'field'}}
        },
        'text:201': {
            id: 201,
            name: 'Installer note',
            max_len: 120,
            meta: {ui: {view: 'label'}}
        },
        'text:202': {id: 202, name: 'Unit photo', meta: {ui: {view: 'image'}}},
        'button:200': {
            id: 200,
            name: 'Reset filter',
            meta: {ui: {view: 'button'}}
        },
        'group:200': {
            id: 200,
            name: 'HVAC controls',
            meta: {ui: {view: 'label'}}
        }
    },
    status: {
        'number:200': {value: 22.5},
        'number:201': {value: 48},
        'number:202': {value: 21},
        'enum:200': {value: 'cool'},
        'enum:201': {value: 'auto'},
        'boolean:200': {value: false},
        'boolean:201': {value: true},
        'text:200': {value: 'Lobby'},
        'text:201': {value: 'Serviced 2026-05'},
        'text:202': {value: UNIT_PHOTO},
        'group:200': {value: ['boolean:200', 'number:202', 'enum:200']}
    }
};

/** Virtual components are layered onto a real Shelly device, and this one sits
 *  on the plant's own supply. Without a metering component the HVAC circuit —
 *  usually a building's largest single load — would be invisible to the site
 *  meter, which can only sum what a device actually reports. */
function hvacControllerComponents(): ProfileComponents {
    const metering = pmComponents(1);
    metering.config['pm1:0'] = {id: 0, name: 'HVAC circuit'};
    return mergeComponents(hvacComponents, metering);
}

// Neo smart water valve (XT1). Its readings are virtual components carrying a
// declared role, and the unit sits on the owning service, not the component —
// see modules/sensor/virtualSensorConfig.ts. Roles and units are transcribed
// from Shelly's own page (docs/Devices/ShellyX/XT1/NeoAdvancedWaterValve.md):
// flow_rate m3/min, water_consumption total m3, water_pressure kPa,
// water_temperature C, state open/close.
const neoValveComponents: ProfileComponents = {
    // No `service:0` component: the simulator has no Service namespace, and
    // the volume counter never reads the owning service anyway — it needs the
    // object key, the role and the value.counter.total leaf, nothing else.
    // The readings below are already in each kind's canonical unit.
    config: {
        'number:200': {
            id: 200,
            name: 'Flow rate',
            _attrs: {owner: 'service:0', role: 'flow_rate'},
            access: 'cr',
            meta: {ui: {view: 'label', unit: 'm³/min'}}
        },
        'number:201': {
            id: 201,
            name: 'Water pressure',
            _attrs: {owner: 'service:0', role: 'water_pressure'},
            access: 'cr',
            meta: {ui: {view: 'label', unit: 'kPa'}}
        },
        'number:202': {
            id: 202,
            name: 'Water temperature',
            _attrs: {owner: 'service:0', role: 'water_temperature'},
            access: 'cr',
            meta: {ui: {view: 'label', unit: '°C'}}
        },
        'boolean:200': {
            id: 200,
            name: 'Valve',
            _attrs: {owner: 'service:0', role: 'state'},
            access: 'crw',
            meta: {ui: {view: 'toggle', titles: {0: 'Closed', 1: 'Open'}}}
        },
        'object:200': {
            id: 200,
            name: 'Water consumption',
            _attrs: {owner: 'service:0', role: 'water_consumption'},
            access: 'cr',
            meta: {ui: {view: 'label'}}
        }
    },
    status: {
        'number:200': {value: 0.012},
        'number:201': {value: 310.5},
        'number:202': {value: 27.4},
        'boolean:200': {value: true},
        // The counter FM stores as volume_m3 — it reads value.counter.total
        // and nothing else (virtualSensorCapture.ts:437). A meter reports a
        // running total, so this only ever climbs.
        'object:200': {value: {counter: {total: 184.372}}}
    }
};

// Irrigation Controller (XT1): six zones, weather-adjusted. Roles and shapes
// transcribed from Shelly's own page
// (docs/Devices/ShellyX/XT1/IrrigationController.md): zone0..zone5 booleans,
// average_temperature and last_precipitation numbers, active_sequence enum,
// and zones_status, the object carrying each zone's duration and start time.
const irrigationZoneCount = 6;

const irrigationComponents: ProfileComponents = {
    config: {
        ...Object.fromEntries(
            Array.from({length: irrigationZoneCount}, (_, zone) => [
                `boolean:${200 + zone}`,
                {
                    id: 200 + zone,
                    name: `Zone ${zone}`,
                    _attrs: {owner: 'service:0', role: `zone${zone}`},
                    access: 'crw',
                    meta: {
                        ui: {view: 'toggle', titles: {0: 'Off', 1: 'Watering'}}
                    }
                }
            ])
        ),
        'number:200': {
            id: 200,
            name: 'Average temperature',
            _attrs: {owner: 'service:0', role: 'average_temperature'},
            access: 'cr',
            meta: {ui: {view: 'label', unit: '°C'}}
        },
        'number:201': {
            id: 201,
            name: 'Last precipitation',
            _attrs: {owner: 'service:0', role: 'last_precipitation'},
            access: 'cr',
            meta: {ui: {view: 'label', unit: 'mm'}}
        },
        'enum:200': {
            id: 200,
            name: 'Active sequence',
            _attrs: {owner: 'service:0', role: 'active_sequence'},
            access: 'crw',
            options: ['seq_0', 'seq_1'],
            meta: {
                ui: {
                    view: 'dropdown',
                    titles: {seq_0: 'Morning run', seq_1: 'Evening run'}
                }
            }
        },
        'object:201': {
            id: 201,
            name: 'Zones status',
            _attrs: {owner: 'service:0', role: 'zones_status'},
            access: 'cr',
            meta: {ui: {view: 'label'}}
        }
    },
    status: {
        ...Object.fromEntries(
            Array.from({length: irrigationZoneCount}, (_, zone) => [
                `boolean:${200 + zone}`,
                {value: false}
            ])
        ),
        'number:200': {value: 31.8},
        'number:201': {value: 0},
        'enum:200': {value: 'seq_0'},
        // Not object:200: that id is the water counter the telemetry engine
        // advances, and a zones map is not a meter.
        'object:201': {
            value: Object.fromEntries(
                Array.from({length: irrigationZoneCount}, (_, zone) => [
                    `zone${zone}`,
                    {duration: 10, started_at: null, source: 'init'}
                ])
            )
        }
    }
};

export const VIRTUAL_PROFILES: readonly DeviceProfile[] = Object.freeze([
    virtualProfile(
        {
            key: 'irrigation-controller',
            displayName: 'Irrigation Controller (XT1)',
            idPrefix: 'irrigation',
            macPrefix: 'F1EE0400',
            model: 'XT1-IRRIG6',
            app: 'IrrigationController'
        },
        'Boolean',
        irrigationComponents
    ),
    virtualProfile(
        {
            key: 'neo-water-valve',
            displayName: 'Neo smart water valve',
            idPrefix: 'neovalveadv',
            macPrefix: 'F1EE0300',
            model: 'NEO-VALVE-ADV',
            app: 'NeoWaterValve'
        },
        'Object',
        neoValveComponents
    ),
    virtualProfile(
        {
            key: 'virtual-hybrid-inverter',
            displayName: 'Hybrid Inverter (virtual)',
            idPrefix: 'virtinverter',
            macPrefix: 'F1EE0100',
            model: 'VIRT-INV1',
            app: 'VirtualInverter'
        },
        'Number',
        inverterComponents
    ),
    virtualProfile(
        {
            key: 'virtual-hvac-controller',
            displayName: 'HVAC Controller (virtual)',
            idPrefix: 'virthvac',
            macPrefix: 'F1EE0200',
            model: 'VIRT-HVAC1',
            app: 'VirtualHVAC'
        },
        'Enum',
        hvacControllerComponents()
    )
]);
